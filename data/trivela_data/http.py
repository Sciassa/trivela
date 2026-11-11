"""Polite cached HTTP access to free sources (Wikipedia, Wikidata, GitHub raw)."""

from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
USER_AGENT = "TrivelaQuizBot/0.1 (non-commercial open-data football quiz pipeline; python-urllib)"

_last_call: dict[str, float] = {}


def _cache_path(key: str) -> Path:
    h = hashlib.sha1(key.encode()).hexdigest()
    return CACHE / h[:2] / f"{h}.txt"


def get(url: str, params: dict | None = None, *, data: dict | None = None, min_interval: float = 1.2,
        retries: int = 10, expect_json: bool = True) -> str:
    """GET (or POST form) with on-disk cache, rate limiting and retries on 429/5xx/non-JSON."""
    full = url + ("?" + urllib.parse.urlencode(params) if params else "")
    key = full + ("|POST|" + urllib.parse.urlencode(data) if data else "")
    path = _cache_path(key)
    if path.exists():
        return path.read_text(encoding="utf-8")
    host = urllib.parse.urlparse(url).netloc
    delay = 5.0
    for attempt in range(retries):
        wait = _last_call.get(host, 0) + min_interval - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_call[host] = time.time()
        body = urllib.parse.urlencode(data).encode() if data else None
        req = urllib.request.Request(full, data=body, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                text = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                retry_after = e.headers.get("Retry-After") if e.headers else None
                wait_s = float(retry_after) + 1 if retry_after and retry_after.isdigit() else delay
                print(f"[http] {e.code} from {host}, waiting {wait_s:.0f}s", flush=True)
                time.sleep(min(wait_s, 1800))
                delay = min(delay * 1.7, 120)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(delay)
            delay = min(delay * 1.7, 120)
            continue
        if expect_json:
            try:
                json.loads(text)
            except json.JSONDecodeError:
                time.sleep(delay)
                delay = min(delay * 1.7, 120)
                continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return text
    raise RuntimeError(f"Failed after {retries} attempts: {full[:200]}")


def get_json(url: str, params: dict | None = None, **kw) -> dict:
    return json.loads(get(url, params, **kw))


# --------------------------------------------------------------------------- Wikipedia
# The MediaWiki action API is heavily rate-limited for shared egress IPs, so the
# pipeline reads raw wikitext (index.php?action=raw) and resolves QIDs via SPARQL.

def canonical_title(t: str) -> str:
    t = t.replace("_", " ").strip()
    return t[:1].upper() + t[1:] if t else t


def wp_raw(title: str, lang: str = "en") -> str | None:
    """Raw wikitext following one redirect; None if missing."""
    title = canonical_title(title)
    for _ in range(3):
        url = f"https://{lang}.wikipedia.org/w/index.php"
        try:
            text = get(url, {"title": title, "action": "raw"}, expect_json=False, min_interval=1.0)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise
        if not text.strip():
            return None
        m = re.match(r"\s*#redirect\s*\[\[([^\]|#]+)", text, re.IGNORECASE)
        if not m:
            return text
        title = canonical_title(m.group(1))
    return None


def wp_redirect_target(title: str, lang: str = "en") -> str | None:
    title = canonical_title(title)
    try:
        text = get(f"https://{lang}.wikipedia.org/w/index.php", {"title": title, "action": "raw"},
                   expect_json=False, min_interval=1.0)
    except urllib.error.HTTPError:
        return None
    m = re.match(r"\s*#redirect\s*\[\[([^\]|#]+)", text, re.IGNORECASE)
    return canonical_title(m.group(1)) if m else title


def wp_wikitext(titles: list[str], lang: str = "en") -> dict[str, str]:
    out: dict[str, str] = {}
    for t in titles:
        text = wp_raw(t, lang)
        if text is not None:
            out[t] = text
    return out


def wp_links(title: str, lang: str = "en") -> list[str]:
    text = wp_raw(title, lang) or ""
    return sorted({canonical_title(m.group(1)) for m in re.finditer(r"\[\[([^\[\]|#:]+)(?:[|#][^\]]*)?\]\]", text)})


def _sparql_titles(titles: list[str], lang: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(titles), 120):
        chunk = titles[i:i + 120]
        values = " ".join(json.dumps(t, ensure_ascii=False) + f"@{lang}" for t in chunk)
        rows = sparql(f"""SELECT ?title ?item WHERE {{ VALUES ?title {{ {values} }}
  ?article schema:about ?item ; schema:isPartOf <https://{lang}.wikipedia.org/> ; schema:name ?title . }}""")
        for r in rows:
            out[r["title"]] = r["item"].rsplit("/", 1)[-1]
    return out


class RateLimited(Exception):
    pass


def wp_summary_qid(title: str, lang: str = "en") -> str | None:
    """QID via the REST summary endpoint (follows redirects). Raises RateLimited on 429."""
    t = urllib.parse.quote(canonical_title(title).replace(" ", "_"), safe="")
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{t}"
    path = _cache_path(url)
    if not path.exists():
        wait = _last_call.get("rest", 0) + 0.4 - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_call["rest"] = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                text = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise RateLimited() from e
            return None
        except (urllib.error.URLError, TimeoutError):
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("wikibase_item")
    except json.JSONDecodeError:
        return None


def wp_qids(titles: list[str], lang: str = "en") -> dict[str, str]:
    """Map Wikipedia titles to Wikidata QIDs: SPARQL on sitelinks, REST summary for redirects."""
    uniq = sorted({t for t in titles if t})
    canon = {t: canonical_title(t) for t in uniq}
    found = _sparql_titles(sorted(set(canon.values())), lang)
    out = {}
    missing = []
    for t in uniq:
        q = found.get(canon[t])
        if q:
            out[t] = q
        else:
            missing.append(t)
    print(f"[qids] {len(out)} via SPARQL, {len(missing)} via REST", flush=True)
    for i, t in enumerate(missing):
        try:
            q = wp_summary_qid(t, lang)
        except RateLimited:
            print(f"[qids] rate limited after {i} REST lookups: {len(missing) - i} titles keep a Wikipedia id", flush=True)
            break
        if q:
            out[t] = q
    return out


# --------------------------------------------------------------------------- Wikidata

def sparql(query: str) -> list[dict]:
    d = json.loads(get("https://query.wikidata.org/sparql", data={"query": query, "format": "json"},
                       min_interval=3.0, retries=20))
    rows = []
    for b in d["results"]["bindings"]:
        rows.append({k: v["value"] for k, v in b.items()})
    return rows

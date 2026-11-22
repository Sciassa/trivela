"""Club crests and player photos from Wikidata + Wikimedia Commons (SPEC §0.8, v16). Run by hand, never by the app.

    uv run python -m trivela_data.assets fetch [--photos N] [--download M]
        network: identities and licences of the N most famous players' photos and of the crests; files downloaded
        (crests, then the first M photos by fame), cached and idempotent: run it again to continue a batch;
        identities and licences are looked up again only with --refresh
    uv run python -m trivela_data.assets build                offline: licence filter, pixel-art variants, manifest

Identity: a club is matched ONLY through its Transfermarkt team ID on Wikidata (P7223), a player ONLY through his
Transfermarkt player ID (P2446); the match must be one item for one ID. Never by name.
Files: the crest is the club's logo statement (P154, the current one), the photo the item's image (P18). Both live on
Wikimedia Commons, whose machine-readable licence (imageinfo + extmetadata) decides what may be published:

- CC0, public domain, CC BY, CC BY-SA: published, credited in the assets manifest; derivatives allowed (a CC BY-SA
  derivative stays CC BY-SA);
- CC BY-ND (no derivatives): never modified, so never used by a transforming game; NC licences, GFDL-only, non-free,
  unknown or missing licences: not published at all.

Rejected sources (SPEC §0.8): API-Football media and TheSportsDB artwork carry no per-file licence that can be checked.
Commons is rate-limited: one batched API call at a time, `Retry-After` honoured, standard thumbnail widths only.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

from .managers import UA as BASE_UA
from .managers import sparql
from .paths import CACHE, REPO, ROOT

ASSET_CACHE = CACHE / "assets"
SOURCES = ROOT / "static" / "assets_sources.json"  # identities and licences, versioned: the build is reproducible
PUBLIC = REPO / "apps" / "web" / "public"
API = "https://commons.wikimedia.org/w/api.php"
CREST_W, PHOTO_W = 250, 330  # standard Commons thumbnail steps
META_FIELDS = "License|LicenseShortName|LicenseUrl|Artist|Credit|Restrictions|Copyrighted|AttributionRequired|UsageTerms|NonFree"
_last = [0.0]
# Wikimedia asks automated clients for a contact in the User-Agent and gives them wider limits: set it by hand if you
# wish (an e-mail or a page about the tool), it is never filled in automatically.
UA = BASE_UA + (f" contact: {os.environ['TRIVELA_UA_CONTACT']}" if os.environ.get("TRIVELA_UA_CONTACT") else "")
FILE_GAP = 12.0  # seconds between two file downloads at least: about 5 a minute, under the burst limit
BYTES_PER_S = 9000  # Wikimedia's budget for clients without a contact is 600 kB a minute: stay under it


def polite_get(url: str, *, binary: bool = False, gap: float = 1.5):
    """GET with a pause between calls and Retry-After on 429/503: Wikimedia's rules for automated clients.

    The request goes through curl (HTTP/2) with our own User-Agent: Wikimedia's edge answered Python's HTTP/1.1 client
    with 429 at any pace. Nothing is disguised: the agent names this pipeline, the pace stays one call per `gap` seconds.
    """
    for attempt in range(10):
        wait = _last[0] + gap - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        r = subprocess.run(["curl", "-sS", "--http2", "-A", UA, "-D", "-", "-o", "-", "--max-time", "90", url], capture_output=True, check=False)
        head, _, body = r.stdout.partition(b"\r\n\r\n")
        while head.startswith((b"HTTP/1.1 200 Connection", b"HTTP/1.0 200 Connection")):
            head, _, body = body.partition(b"\r\n\r\n")  # the proxy's CONNECT answer comes first
        m = re.match(rb"HTTP/[\d.]+ (\d+)", head)
        code = int(m.group(1)) if m else 0
        if code == 200:
            if binary:  # the next call waits as long as this file "costs" in the byte budget
                _last[0] = time.time() + max(0.0, len(body) / BYTES_PER_S - gap)
            return body if binary else json.loads(body)
        if code and code not in (429, 500, 502, 503, 504):
            raise RuntimeError(f"HTTP {code}: {url[:90]}")
        ra = re.search(rb"(?im)^retry-after:\s*(\d+)", head)
        pause = min(900, int(ra.group(1)) if ra else 10 * (attempt + 1))
        print(f"  {code or 'rete'}, pausa di {pause} s", flush=True)
        time.sleep(pause)
    raise RuntimeError(f"Commons not reachable: {url[:90]}")


def strip_html(s: str) -> str:
    text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", s or "")).split())
    return re.sub(r"\s+([),.;:])", r"\1", re.sub(r"\(\s+", "(", text))


def classify(em: dict) -> dict:
    """Licence class of a Commons file from its extmetadata."""
    v = lambda k: (em.get(k) or {}).get("value", "") if isinstance(em.get(k), dict) else (em.get(k) or "")
    lic, short = v("License").lower().strip(), v("LicenseShortName").strip()
    out = {"licence": short or lic or "sconosciuta", "licence_url": v("LicenseUrl"), "author": strip_html(v("Artist")) or "autore sconosciuto",
           "credit": strip_html(v("Credit")), "trademark": "trademark" in v("Restrictions").lower()}
    if v("NonFree").lower() == "true":
        return out | {"class": "nonfree", "publish": False, "modifiable": False}
    if lic == "cc0":
        return out | {"class": "cc0", "publish": True, "modifiable": True}
    if lic.startswith("pd") or "public domain" in short.lower():
        return out | {"class": "pd", "publish": True, "modifiable": True}
    m = re.match(r"cc-(by(?:-sa)?(?:-nc)?(?:-nd)?)", lic)
    if m:
        kind = m.group(1)
        if "nc" in kind:
            return out | {"class": f"cc-{kind}", "publish": False, "modifiable": False}
        return out | {"class": f"cc-{kind}", "publish": True, "modifiable": "nd" not in kind}
    return out | {"class": "unknown", "publish": False, "modifiable": False}


def file_title(url: str) -> str:
    return urllib.parse.unquote(url.rsplit("/", 1)[-1]).replace("_", " ")


def commons_info(titles: list[str], width: int) -> dict[str, dict]:
    out = {}
    for i in range(0, len(titles), 50):
        q = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|extmetadata|mime|size|sha1",
                                    "iiurlwidth": width, "iiextmetadatafilter": META_FIELDS, "titles": "|".join("File:" + t for t in titles[i:i + 50])})
        d = polite_get(f"{API}?{q}")
        norm = {n["to"]: n["from"] for n in d["query"].get("normalized", [])}
        for p in d["query"]["pages"].values():
            ii = (p.get("imageinfo") or [None])[0]
            if not ii:
                continue
            title = norm.get(p["title"], p["title"]).removeprefix("File:")
            bare = lambda u: (u or "").split("?")[0]
            out[title] = {"title": p["title"].removeprefix("File:"), "page": ii.get("descriptionurl"), "url": bare(ii.get("url")),
                          "thumb": bare(ii.get("thumburl")), "mime": ii.get("mime"), "sha1": ii.get("sha1"),
                          "width": ii.get("width"), "height": ii.get("height")} | classify(ii.get("extmetadata") or {})
        print(f"  commons {min(i + 50, len(titles))}/{len(titles)}", flush=True)
    return out


def cached(url: str, ext: str, offline: bool = False) -> Path | None:
    """Download once: the file is kept in data/cache/assets (not versioned). Offline (the build), a missing file is None."""
    p = ASSET_CACHE / "files" / (hashlib.sha1(url.encode()).hexdigest()[:20] + ext)
    if not p.exists():
        if offline:
            return None
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(polite_get(url, binary=True, gap=FILE_GAP))
    return p


def crest_source(c: dict, offline: bool = False) -> Path | None:
    """The crest as Commons draws it: the standard 250 px thumbnail (a PNG with its transparency, SVG files included)."""
    return cached(c["thumb"], ".png", offline)


def crest_svg(c: dict, offline: bool = False) -> Path | None:
    """The original SVG, needed only to drop the lettering (the «senza scritte» variant)."""
    return cached(c["url"], ".svg", offline) if c["mime"] == "image/svg+xml" else None


def sparql_retry(q: str) -> list[dict]:
    """Wikidata SPARQL, retried on timeouts too (a long VALUES list can take its time)."""
    for attempt in range(5):
        try:
            return sparql(q)
        except (TimeoutError, OSError) as e:
            print(f"  wikidata: {type(e).__name__}, nuovo tentativo", flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("Wikidata not reachable")


# ------------------------------------------------------------------ identities
def one_to_one(rows: list[dict], key: str, val: str) -> dict[str, list[dict]]:
    """Keep the IDs that point at exactly one Wikidata item, and items that carry exactly one of the IDs."""
    items_of, ids_of = {}, {}
    for r in rows:
        items_of.setdefault(r[key], set()).add(r["item"])
        ids_of.setdefault(r["item"], set()).add(r[key])
    out = {}
    for r in rows:
        if len(items_of[r[key]]) == 1 and len(ids_of[r["item"]]) == 1 and r.get(val):
            out.setdefault(r[key], []).append(r)
    return out


def current_logo(statements: list[dict]) -> dict | None:
    """The logo in use: the preferred statement, else the only one without an end date."""
    pref = [s for s in statements if s["rank"].endswith("PreferredRank")]
    live = [s for s in statements if not s["rank"].endswith("DeprecatedRank") and not s.get("end")]
    pick = pref if len(pref) == 1 else live if len(live) == 1 else []
    return pick[0] if pick else None


def download_files(crests: dict, photos_: dict, order: dict[int, int], download: int) -> None:
    """The files: only those that may be published are downloaded at all; crests (thumbnails, then the SVG originals
    for the «senza scritte» variant), then photos by fame."""
    for k, r in enumerate(r for r in crests.values() if r.get("commons") and r["commons"]["publish"]):
        crest_source(r["commons"])
        if k % 20 == 0:
            print(f"  crests {k}", flush=True)
    for k, r in enumerate(r for r in crests.values() if r.get("commons") and r["commons"]["publish"] and r["commons"]["modifiable"]):
        crest_svg(r["commons"])
        if k % 20 == 0:
            print(f"  svg {k}", flush=True)
    pics = sorted((r for r in photos_.values() if r.get("commons") and r["commons"]["publish"] and r["commons"]["modifiable"]),
                  key=lambda r: order.get(r["player"], 10**9))
    for k, r in enumerate(pics[:download]):
        cached(r["commons"]["thumb"], ".jpg")
        if k % 25 == 0:
            print(f"  photos {k}/{min(download, len(pics))}", flush=True)
    print("fetch done", flush=True)


def fetch(photos: int, download: int, refresh: bool) -> None:
    from .tm_core import L5, TM

    t = TM()
    if SOURCES.exists() and not refresh:
        # identities and licences already looked up: only the missing files are downloaded
        src = json.loads(SOURCES.read_text(encoding="utf-8"))
        top = sorted(t.notable, key=lambda p: (-t.fame(p), p))
        download_files(src["crests"], src["photos"], {p: n for n, p in enumerate(top)}, download)
        return
    cups = {int(c) for c, in t.q("select distinct club from pres join gm using(gid) where comp in ('CL', 'EL', 'UCOL')")}
    clubs = sorted({c for lg in L5 for c in t.seasons_in[lg]} | cups)
    vals = " ".join(f'"{c}"' for c in clubs)
    rows = sparql_retry(f"""SELECT ?item ?tm ?logo ?rank ?end WHERE {{ VALUES ?tm {{ {vals} }} ?item wdt:P7223 ?tm .
        OPTIONAL {{ ?item p:P154 ?st . ?st ps:P154 ?logo ; wikibase:rank ?rank . OPTIONAL {{ ?st pq:P582 ?end }} }} }}""")
    crests = {}
    for tm, sts in one_to_one(rows, "tm", "logo").items():
        st = current_logo(sts)
        if st:
            crests[tm] = {"club": int(tm), "qid": st["item"].rsplit("/", 1)[-1], "file": file_title(st["logo"])}
    print(f"crests: {len(clubs)} clubs, {len(crests)} with one current logo on Wikidata", flush=True)
    top = sorted(t.notable, key=lambda p: (-t.fame(p), p))[:photos]
    people = []
    for i in range(0, len(top), 150):
        pv = " ".join(f'"{p}"' for p in top[i:i + 150])
        people += sparql_retry(f'SELECT ?item ?tm ?img WHERE {{ VALUES ?tm {{ {pv} }} ?item wdt:P2446 ?tm . OPTIONAL {{ ?item wdt:P18 ?img }} }}')
        time.sleep(1.2)
    photos_ = {}
    for tm, rs in one_to_one(people, "tm", "img").items():
        imgs = {r["img"] for r in rs}
        if len(imgs) == 1:  # one image only: no guessing which one shows him
            photos_[tm] = {"player": int(tm), "qid": rs[0]["item"].rsplit("/", 1)[-1], "file": file_title(imgs.pop())}
    print(f"photos: {len(top)} most famous players, {len(photos_)} with one image on Wikidata", flush=True)
    old = json.loads(SOURCES.read_text(encoding="utf-8")) if SOURCES.exists() else {"crests": {}, "photos": {}}
    for kind, recs, width in (("crests", crests, CREST_W), ("photos", photos_, PHOTO_W)):
        known = {r["file"]: r["commons"] for r in old.get(kind, {}).values() if r.get("commons")}
        missing = sorted({r["file"] for r in recs.values() if r["file"] not in known})
        info = commons_info(missing, width) if missing else {}
        for r in recs.values():
            r["commons"] = known.get(r["file"]) or info.get(r["file"])
    SOURCES.parent.mkdir(parents=True, exist_ok=True)
    SOURCES.write_text(json.dumps({"crests": crests, "photos": photos_}, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    download_files(crests, photos_, {p: n for n, p in enumerate(top)}, download)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["fetch"]:
        n = int(args[args.index("--photos") + 1]) if "--photos" in args else 1000
        fetch(n, int(args[args.index("--download") + 1]) if "--download" in args else n, "--refresh" in args)
    elif args[:1] == ["build"]:
        from .asset_build import build

        build()
    else:
        raise SystemExit(__doc__)

"""Manager birth dates from Wikidata (CC0), matched to the manager names of the Transfermarkt match sheets.

Wikidata is used ONLY for this (SPEC §0.6). A manager is kept only when exactly one Wikidata person with a
Transfermarkt manager ID (P2447) has that exact name and a day-precision date of birth.
The result is versioned in data/static/managers.json so that generation is offline and reproducible.
Refresh with:  uv run python -m trivela_data.managers
"""

from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

import duckdb

from .paths import ROOT

STATIC = ROOT / "static" / "managers.json"
UA = "TrivelaQuizBot/0.5 (non-commercial football quiz data pipeline)"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s).split())


def sparql(q: str) -> list[dict]:
    for _ in range(5):
        req = urllib.request.Request("https://query.wikidata.org/sparql", headers={"User-Agent": UA, "Accept": "application/json"},
                                     data=urllib.parse.urlencode({"query": q, "format": "json"}).encode())
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.load(r)
            return [{k: v["value"] for k, v in b.items()} for b in d["results"]["bindings"]]
        except urllib.error.HTTPError as e:
            ra = e.headers.get("Retry-After") if e.headers else None
            time.sleep(min(int(ra) if ra and ra.isdigit() else 15, 120))
    raise RuntimeError("Wikidata not reachable")


def refresh(tm_db: str) -> dict:
    rows = sparql("SELECT ?p ?dob WHERE { ?p wdt:P2447 ?tm ; wdt:P569 ?dob }")
    dobs: dict[str, set[str]] = {}
    for r in rows:
        dobs.setdefault(r["p"].rsplit("/", 1)[-1], set()).add(r["dob"][:10])
    qids = sorted(q for q, v in dobs.items() if len(v) == 1 and not next(iter(v)).endswith("-01-01"))
    by_name: dict[str, set[str]] = {}
    for i in range(0, len(qids), 400):
        vals = " ".join("wd:" + q for q in qids[i:i + 400])
        for r in sparql(f'SELECT ?p ?l WHERE {{ VALUES ?p {{ {vals} }} ?p rdfs:label ?l FILTER(lang(?l) IN ("en","it")) }}'):
            by_name.setdefault(norm(r["l"]), set()).add(r["p"].rsplit("/", 1)[-1])
        time.sleep(1.2)
    return match(tm_db, dobs, by_name)


def match(tm_db: str, dobs: dict[str, set[str]], by_name: dict[str, set[str]]) -> dict:
    con = duckdb.connect(tm_db, read_only=True)
    names = [r[0] for r in con.execute(
        "select distinct n from (select home_club_manager_name n from games union all select away_club_manager_name from games) where n is not null"
    ).fetchall()]
    out = {}
    for n in names:
        cands = by_name.get(norm(n), set())
        if len(cands) == 1:
            q = next(iter(cands))
            out[n] = {"qid": q, "dob": next(iter(dobs[q]))}
    return dict(sorted(out.items()))


def load() -> dict[str, dict]:
    return json.loads(STATIC.read_text(encoding="utf-8")) if STATIC.exists() else {}


if __name__ == "__main__":
    from .tm_core import TM_DB, ensure_db
    ensure_db()
    data = refresh(str(TM_DB))
    STATIC.parent.mkdir(parents=True, exist_ok=True)
    STATIC.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
    print(len(data), "managers with a verified birth date")

"""Download (and cache) every free source used by the pipeline."""

from __future__ import annotations

import re
import subprocess
import sys

from . import http
from .paths import OF_DIR, SB_RAW, WC_YEARS

OF_REPOS = ["worldcup.json", "worldcup", "football.json"]


def clone_openfootball() -> None:
    OF_DIR.mkdir(parents=True, exist_ok=True)
    for repo in OF_REPOS:
        target = OF_DIR / repo
        if target.exists():
            continue
        subprocess.run(["git", "clone", "-q", "--depth", "1", f"https://github.com/openfootball/{repo}", str(target)],
                       check=True)


def wc_pages(year: int) -> list[str]:
    """Main article + stage pages referenced by links, {{main}} or transclusions."""
    main = f"{year} FIFA World Cup"
    text = http.wp_raw(main) or ""
    refs = set(http.wp_links(main))
    for m in re.finditer(r"\{\{\s*(?::|main\s*\||see also\s*\||further\s*\|)\s*([^}|]+)", text, re.IGNORECASE):
        refs.add(http.canonical_title(m.group(1)))
    rx = re.compile(rf"^{year} FIFA World Cup (group|knockout|final|second|first|play|round|third|semi|quarter|decid)",
                    re.IGNORECASE)
    stage = sorted({t for t in refs if rx.match(t) and "squads" not in t.lower() and "qualif" not in t.lower()})
    return [main] + stage


def fetch_wikipedia() -> None:
    for y in WC_YEARS:
        pages = wc_pages(y)
        http.wp_wikitext(pages)
        http.wp_wikitext([f"{y} FIFA World Cup squads"])
        print(f"wikipedia {y}: {len(pages)} pages", flush=True)


def fetch_statsbomb() -> None:
    comps = http.get_json(f"{SB_RAW}/data/competitions.json", min_interval=0.2)
    wanted = [c for c in comps if c["competition_id"] == 43 and c["competition_gender"] == "male"]
    for c in wanted:
        matches = http.get_json(f"{SB_RAW}/data/matches/{c['competition_id']}/{c['season_id']}.json",
                                min_interval=0.2)
        for m in matches:
            http.get_json(f"{SB_RAW}/data/lineups/{m['match_id']}.json", min_interval=0.2)
        print(f"statsbomb {c['season_name']}: {len(matches)} matches", flush=True)


def main() -> None:
    what = sys.argv[1:] or ["openfootball", "statsbomb", "wikipedia"]
    if "openfootball" in what:
        clone_openfootball()
    if "statsbomb" in what:
        fetch_statsbomb()
    if "wikipedia" in what:
        fetch_wikipedia()


if __name__ == "__main__":
    main()

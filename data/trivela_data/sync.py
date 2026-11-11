"""Weekly free sync: refresh sources and regenerate the packs.

- Transfermarkt consolidated history: re-downloaded only if the R2 file is newer than the local copy.
- National teams (martj42) and 2026/27 delta (open-matchday): downloaded fresh on every run.
- World Cup graph: data/build/graph.json is versioned, so no Wikipedia crawl is needed here.
"""

from __future__ import annotations

import email.utils
import urllib.request

from . import generate, http
from .fetch import clone_openfootball
from .gen_tm import TM_DB, TM_DB_URL, ensure_db


def refresh_tm() -> None:
    req = urllib.request.Request(TM_DB_URL, method="HEAD", headers={"User-Agent": http.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            remote = email.utils.parsedate_to_datetime(r.headers["Last-Modified"]).timestamp()
    except Exception as e:  # noqa: BLE001
        print(f"[sync] Transfermarkt HEAD failed ({e}): keeping local copy", flush=True)
        ensure_db()
        return
    if TM_DB.exists() and TM_DB.stat().st_mtime >= remote:
        print("[sync] Transfermarkt history unchanged", flush=True)
        return
    if TM_DB.exists():
        TM_DB.unlink()
    print("[sync] downloading Transfermarkt history…", flush=True)
    ensure_db()


def main() -> None:
    clone_openfootball()
    refresh_tm()
    generate.main()


if __name__ == "__main__":
    main()

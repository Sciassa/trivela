"""Refresh the Transfermarkt history (only if the published file changed) and regenerate the packs."""

from __future__ import annotations

import email.utils
import urllib.request

from . import generate
from .gen_tm import TM_DB, TM_DB_URL, USER_AGENT, ensure_db


def refresh_tm() -> None:
    req = urllib.request.Request(TM_DB_URL, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            remote = email.utils.parsedate_to_datetime(r.headers["Last-Modified"]).timestamp()
    except Exception as e:  # noqa: BLE001
        print(f"[sync] HEAD failed ({e}): keeping the local copy", flush=True)
        ensure_db()
        return
    if TM_DB.exists() and TM_DB.stat().st_mtime >= remote:
        print("[sync] Transfermarkt history unchanged", flush=True)
        return
    if TM_DB.exists():
        TM_DB.unlink()
    print("[sync] downloading the Transfermarkt history…", flush=True)
    ensure_db()


def main() -> None:
    refresh_tm()
    generate.main()


if __name__ == "__main__":
    main()

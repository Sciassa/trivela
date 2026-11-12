from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
CACHE = ROOT / "cache"
OF_DIR = CACHE / "openfootball"
BUILD = ROOT / "build"
PACKS_OUT = REPO / "apps" / "web" / "public" / "data"
SB_RAW = "https://raw.githubusercontent.com/statsbomb/open-data/master"

# FIFA World Cup final tournaments (men).
WC_YEARS = [1930, 1934, 1938] + list(range(1950, 2027, 4))

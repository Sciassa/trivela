"""Name normalisation and cross-source identity matching."""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

SPECIAL = str.maketrans({"ø": "o", "ł": "l", "ß": "ss", "đ": "d", "ð": "d", "æ": "ae", "œ": "oe", "ı": "i", "þ": "th"})


def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s or "").lower().translate(SPECIAL)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"['’`´]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def strip_disambiguation(title: str) -> str:
    return re.sub(r"\s*\([^)]*\)\s*$", "", title).strip()


def name_score(a: str, b: str) -> float:
    """Similarity between two spellings of a person's name (0..1)."""
    A = norm(a).split()
    B = norm(strip_disambiguation(b)).split()
    if not A or not B:
        return 0.0
    if A == B:
        return 1.0
    if A[-1] == B[-1] and len(A[-1]) >= 3:
        return 0.92 if A[0][0] == B[0][0] else 0.82
    if len(A) == 1 and A[0] in B and len(A[0]) >= 3:
        return 0.82
    if len(B) == 1 and B[0] in A and len(B[0]) >= 3:
        return 0.82
    ratio = SequenceMatcher(None, " ".join(A), " ".join(B)).ratio()
    if ratio >= 0.86:
        return 0.8
    common = {t for t in A if len(t) >= 4} & {t for t in B if len(t) >= 4}
    if common:
        return 0.75
    return 0.0


def best_match(name: str, candidates: list[str], threshold: float = 0.75) -> str | None:
    """Unique best candidate above threshold, else None."""
    scored = sorted(((name_score(name, c), c) for c in candidates), reverse=True)
    if not scored or scored[0][0] < threshold:
        return None
    if len(scored) > 1 and scored[1][0] == scored[0][0] and scored[1][1] != scored[0][1]:
        return None
    return scored[0][1]


def same_place(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    na, nb = norm(a), norm(strip_disambiguation(b))
    if na == nb:
        return True
    return SequenceMatcher(None, na, nb).ratio() >= 0.85 or na in nb.split() or nb in na.split()


def same_club(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    stop = {"fc", "cf", "ac", "as", "ssc", "sc", "cd", "afc", "club", "de", "f", "c", "calcio", "sv", "fk", "sk"}
    ta = {t for t in norm(a).split() if t not in stop}
    tb = {t for t in norm(strip_disambiguation(b)).split() if t not in stop}
    if not ta or not tb:
        return False
    return bool(ta & tb) or SequenceMatcher(None, " ".join(sorted(ta)), " ".join(sorted(tb))).ratio() >= 0.85

"""Validate curated questions in content/questions/*.json (SPEC §9)."""

from __future__ import annotations

import json
import sys

from .paths import REPO

REQUIRED = ["id", "game", "archetype", "status", "difficulty", "question", "answer", "year_min", "year_max",
            "script", "claims", "author"]


def validate(item: dict) -> list[str]:
    errs = [f"missing field {k}" for k in REQUIRED if k not in item]
    if errs:
        return errs
    if item["status"] not in ("draft", "verified", "published", "retired"):
        errs.append("bad status")
    for i, claim in enumerate(item["claims"]):
        ok = [s for s in claim.get("sources", []) if s.get("url") and s.get("quote") and s.get("family") != "brief"]
        if not ok:
            errs.append(f"claim {i}: needs one authoritative source with url and quote (SPEC §0.3)")
    if item["status"] in ("verified", "published"):
        if not item.get("reviewer") or item.get("reviewer") == item.get("author"):
            errs.append("reviewer must differ from author")
    if "options" in item:
        if len(item["options"]) != 4 or not (0 <= item.get("correct", -1) < 4):
            errs.append("multiple choice needs 4 options and correct index")
    return errs


def load_published() -> list[dict]:
    out = []
    for p in sorted((REPO / "content" / "questions").glob("*.json")):
        item = json.loads(p.read_text(encoding="utf-8"))
        if item.get("status") == "published" and not validate(item):
            out.append(item)
    return out


def main() -> int:
    bad = 0
    files = sorted((REPO / "content" / "questions").glob("*.json"))
    for p in files:
        item = json.loads(p.read_text(encoding="utf-8"))
        if item.get("status") == "draft":
            continue
        errs = validate(item)
        for e in errs:
            print(f"{p.name}: {e}")
        bad += bool(errs)
    print(f"{len(files)} file, {bad} con errori")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

"""Final pass: drop every case already seen in the TV episodes used as inspiration, and double-check notoriety."""

from __future__ import annotations

import json

# Every fingerprint is a tuple of substrings that must ALL appear in the serialized item.
SHOW_FINGERPRINTS: list[tuple[str, ...]] = [
    ("El Shaarawy", "compleanno"), ("Lukaku", "compleanno"), ("Mertens", "compleanno"), ("Eto'o", "compleanno"),
    ("Palacio", "compleanno"), ("Kalulu", "Inter", "Juventus", "2026"), ("Montolivo", "espuls"), ("Romagnoli", "cognome"),
    ("Romagnoli", "capitan"), ("Di Natale", "Iperzola"), ("Gladstone", "Juventus"), ("Superga",), ("Grande Torino",), ("Elkjær",),
    ("Juventus", "lunedì", "2011/12"), ("Pescara", "Milan", "1992"), ("Manchester United", "Fiorentina", "2000"),
    ("Cesena", "Juventus", "2011"), ("Buffon", "Russia", "1997"), ("Barthez", "De Rossi"), ("Zamparini",), ("Bodø", "sud"),
    ("Tel Aviv", "Champions", "sud"), ("Gasperini", "Mourinho", "compleanno"), ("Gian Piero Gasperini e José Mourinho",),
    ("affrontate più volte dall'Italia",), ("nazionalità Croazia", "marcatori", "Serie A"), ("più alti", "Inter"),
    ("Juventus", "Barcellona", "Doppi ex"), ("Real Madrid", "Roma", "Doppi ex"), ("nazionalità Spagna", "Fiorentina"),
    ("Raspadori", "30 mln", "2022"), ("Medel", "2014", "Cardiff"), ("Gerrard", "Montolivo"), ("presenze in Champions", "senza"),
    ("Milan-Inter 0-2", "2022/23", "semifinale"), ("Spagna-Inghilterra 2-1", "2024"), ("Atalanta-Bayern Monaco 1-6",),
    ("Real Madrid-Manchester City",), ("Manchester City-Real Madrid",), ("Inter-Juventus", "14 febbraio 2026"),
    ("Empoli-Milan", "22 dicembre 2021"), ("Atalanta-Milan", "13 maggio 2018"), ("Milan-Genoa", "27 ottobre 2012"),
]


def is_show_case(item: dict) -> bool:
    blob = json.dumps(item, ensure_ascii=False)
    return any(all(part in blob for part in fp) for fp in SHOW_FINGERPRINTS)


def finalize(packs: dict[str, list[dict]], notable_ids: set[str]) -> tuple[dict[str, list[dict]], dict]:
    report = {}
    out = {}
    for game, items in packs.items():
        keep, show, obscure = [], 0, 0
        for it in items:
            if is_show_case(it):
                show += 1
                continue
            if game in ("maglia", "giramondo", "mercato") and not all(i in notable_ids for i in it["answer"].get("ids", [])):
                obscure += 1
                continue
            keep.append(it)
        out[game] = keep
        report[game] = {"kept": len(keep), "excluded_show": show, "excluded_not_notable": obscure}
    return out, report

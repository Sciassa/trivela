"""Generate the question packs from a single source: the Transfermarkt history (SPEC §0.5).

Writes apps/web/public/data/: manifest.json, entities.json, topics.json, teammates.json and
games/<game_id>.json (one file per game, loaded on demand by the app).
"""

from __future__ import annotations

import datetime as dt
import json

from .gen_tm import TM_DATASET, generate_all
from .paths import PACKS_OUT
from .postprocess import finalize

GAMES = ["tiro_secco", "prima_pagina", "mercato", "decina", "dischetto", "formazione", "cassaforte", "giramondo",
         "frame", "intruso", "asta", "filo_rosso", "mappamondo", "maglia"]


def dump(path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    packs, entities, teammates, topic_nb = generate_all()
    packs = {g: packs.get(g, []) for g in GAMES}
    for game, items in packs.items():
        bad = [it["id"] for it in items if not it["sources"]]
        if bad:
            raise SystemExit(f"{game}: {len(bad)} instances without a source")
        seen: set[str] = set()
        packs[game] = [it for it in items if not (it["id"] in seen or seen.add(it["id"]))]
    packs, entities, report = finalize(packs, entities, {}, {})
    seen_e: set[str] = set()
    entities = [e for e in entities if not (e["id"] in seen_e or seen_e.add(e["id"]))]
    for game, items in packs.items():
        dump(PACKS_OUT / "games" / f"{game}.json", items)
    dump(PACKS_OUT / "entities.json", entities)
    dump(PACKS_OUT / "teammates.json", teammates)
    dump(PACKS_OUT / "topics.json", {"neighbors": topic_nb})
    today = dt.date.today().isoformat()
    manifest = {
        "version": today,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "snapshot": "2026-07-06",
        "counts": {k: len(v) for k, v in packs.items()},
        "sources": [{"family": "transfermarkt",
                     "label": "Transfermarkt (dataset dcaribou/transfermarkt-datasets, stagioni 2012/13–2025/26, Mondiali ed Europei dal 2006)",
                     "url": TM_DATASET, "licence": "Dati © Transfermarkt; dataset pubblico, uso non commerciale"}],
        "filters": report,
    }
    (PACKS_OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest["counts"], indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()

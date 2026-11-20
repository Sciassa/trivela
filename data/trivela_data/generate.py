"""Generate the question packs (SPEC §0.6): Transfermarkt dataset for everything, Wikidata only for managers' birth dates.

Writes apps/web/public/data/: manifest.json, entities.json and games/<game_id>.json (loaded on demand by the app).
"""

from __future__ import annotations

import datetime as dt
import json

from . import gen_anomalie, gen_bandiere, gen_lists, gen_matches, gen_nomi, gen_players, gen_quiz, gen_seasons, gen_testa, gen_vf
from .paths import PACKS_OUT
from .postprocess import finalize
from .tm_core import SNAPSHOT, TM, TM_DATASET, norm

GAMES = ["tiro_secco", "mercato", "decina", "dischetto", "formazione", "giramondo", "asta", "maglia", "testa_a_testa", "statistiche", "stagione",
         "bandiere"]
MIN_ITEMS = 1000
CAPS = {"tiro_secco": 3600, "mercato": 2400, "decina": 1400, "dischetto": 1350, "formazione": 1400,
        "giramondo": 1400, "asta": 1500, "maglia": 1500,
        "testa_a_testa": 1500, "statistiche": 1500, "stagione": 1500, "bandiere": 1500,
        # Tiro Secco: the questions of v10 plus the true-or-false transfers of v14 (gen_vf)
        "tiro_secco_vf": 2000}


def cap(items: list[dict], n: int) -> list[dict]:
    """Keep at most n items, round-robin across generators (most famous first) so that variety is preserved."""
    groups: dict[str, list[dict]] = {}
    for it in sorted(items, key=lambda x: (-x["fame"], x["id"])):
        groups.setdefault(it["generator"], []).append(it)
    out: list[dict] = []
    while len(out) < n and any(groups.values()):
        for g in sorted(groups):
            if groups[g] and len(out) < n:
                out.append(groups[g].pop(0))
    return out


def dump(path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def collect_ids(x, acc: dict[str, str]) -> None:
    """Every {id, name} / entity answer found in the items: id -> display name."""
    if isinstance(x, dict):
        if x.get("kind") == "entity":
            for i in x.get("ids", []):
                acc.setdefault(i, x.get("display", ""))
        if isinstance(x.get("id"), str) and isinstance(x.get("name"), str) and x["id"].startswith("tm:"):
            acc.setdefault(x["id"], x["name"])
        for v in x.values():
            collect_ids(v, acc)
    elif isinstance(x, list):
        for v in x:
            collect_ids(v, acc)


def build_entities(t: TM, packs: dict[str, list[dict]]) -> list[dict]:
    """People only (answers are always people or numbers). One entity per Transfermarkt id; exact duplicates are merged."""
    used: dict[str, str] = {}
    collect_ids(packs, used)
    ents: dict[str, dict] = {}
    seen_people: dict[tuple, str] = {}
    for pid in sorted(set(t.notable) | {int(i.split(":")[2]) for i in used if i.startswith("tm:p:")}, key=lambda p: -t.fame(p)):
        eid = t.pid(pid)
        p = t.players.get(pid)
        name = t.pname(pid)
        key = (norm(name), p["dob"] if p else None)
        if p and p["dob"] and key in seen_people and eid not in used:
            continue  # same name and same birth date: a duplicate profile
        seen_people.setdefault(key, eid)
        ents[eid] = {"id": eid, "kind": "person", "name": name, "aliases": [], "fame": t.fame(pid), "family": t.surname(pid)}
    for eid, name in used.items():
        if eid.startswith(("tm:m:", "tm:r:")) and eid not in ents:
            ents[eid] = {"id": eid, "kind": "person", "name": name, "aliases": [], "fame": 55 if eid.startswith("tm:m:") else 25,
                         "family": name.split()[-1]}
    return sorted(ents.values(), key=lambda e: e["id"])


def main() -> None:
    t = TM()
    packs: dict[str, list[dict]] = {g: [] for g in GAMES}
    for mod in (gen_quiz, gen_anomalie, gen_nomi, gen_matches, gen_lists, gen_players, gen_testa, gen_seasons, gen_bandiere, gen_vf):
        for game, items in mod.generate(t).items():
            packs[game] += items
    for game, items in packs.items():
        seen: set[str] = set()
        packs[game] = [it for it in items if it["sources"] and not (it["id"] in seen or seen.add(it["id"]))]
    packs, report = finalize(packs, {t.pid(p) for p in t.notable})
    # Tiro Secco: its v10 questions keep their own cap; the true-or-false transfers (tag "vf") are added on top of them
    vf = [it for it in packs["tiro_secco"] if it.get("tag") == "vf"]
    packs["tiro_secco"] = [it for it in packs["tiro_secco"] if it.get("tag") != "vf"]
    packs = {g: cap(v, CAPS[g]) for g, v in packs.items()}
    # after the filters, as many true as false moves again («always VERO» must not pay)
    true, false = ([it for it in vf if it["correct"] == c] for c in (0, 1))
    n = min(len(true), len(false), CAPS["tiro_secco_vf"] // 2)
    rank = lambda xs: sorted(xs, key=lambda x: (-x["fame"], x["id"]))[:n]  # noqa: E731
    packs["tiro_secco"] += sorted(rank(true) + rank(false), key=lambda x: (-x["fame"], x["id"]))
    short = {g: len(v) for g, v in packs.items() if len(v) < MIN_ITEMS}
    if short:
        raise SystemExit(f"Giochi sotto le {MIN_ITEMS} domande: {short}")
    entities = build_entities(t, packs)
    for game, items in packs.items():
        dump(PACKS_OUT / "games" / f"{game}.json", items)
    dump(PACKS_OUT / "entities.json", entities)
    manifest = {
        "version": dt.date.today().isoformat(),
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "snapshot": SNAPSHOT,
        "counts": {k: len(v) for k, v in packs.items()},
        "generators": {k: len({it["generator"] for it in v}) for k, v in packs.items()},
        "sources": [
            {"family": "transfermarkt", "label": "Transfermarkt (dataset dcaribou/transfermarkt-datasets, stagioni 2012/13–2025/26)",
             "url": TM_DATASET, "licence": "Dati © Transfermarkt; dataset pubblico, uso non commerciale"},
            {"family": "wikidata", "label": "Wikidata (solo date di nascita degli allenatori)", "url": "https://www.wikidata.org", "licence": "CC0"},
        ],
        "filters": report,
    }
    (PACKS_OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest["counts"], indent=2))
    print(json.dumps(manifest["generators"]), len(entities), "entities")


if __name__ == "__main__":
    main()

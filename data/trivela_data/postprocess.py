"""Final pass over all packs (SPEC §0.4):

1. unify ids: players coming from StatsBomb / Fjelstul are mapped onto existing entities by exact name;
2. exclude every case already seen in the TV-show episodes used as inspiration (fingerprints);
3. notoriety filter: a player can be the protagonist of a question only if notable.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict

from .gen_tm import TM

# Every fingerprint is a tuple of substrings that must ALL appear in the serialized item.
SHOW_FINGERPRINTS: list[tuple[str, ...]] = [
    ("El Shaarawy", "compleanno"), ("Lukaku", "compleanno"), ("Mertens", "compleanno"), ("Eto'o", "compleanno"),
    ("Palacio", "compleanno"), ("Kalulu",), ("Montolivo", "espuls"), ("Romagnoli", "capitan"), ("Di Natale", "Iperzola"),
    ("Gladstone",), ("Superga",), ("Grande Torino",), ("Elkjær",), ("Juventus", "lunedì", "2011/12"),
    ("Pescara", "Milan", "1992"), ("Manchester United", "Fiorentina", "2000"), ("Cesena", "Juventus", "2011"),
    ("Buffon", "Russia", "1997"), ("Barthez", "De Rossi"), ("Zamparini",), ("Bodø",), ("Tel Aviv", "Champions"),
    ("Gasperini", "Mourinho"), ("affrontate più volte dall'Italia",), ("cittadinanza Croazia", "Serie A"),
    ("più alti", "Inter"), ("Juventus", "Barcellona", "Doppi ex"), ("Real Madrid", "Roma", "Doppi ex"),
    ("Spagna", "Fiorentina", "nazionalità"), ("Raspadori", "2022"), ("Medel", "2014"), ("Gerrard", "Montolivo"),
    ("presenze in Champions", "senza"), ("Milan-Inter", "2023"), ("Inter-Milan", "2023", "Champions"),
    ("Spagna-Inghilterra", "2024"), ("Spain-England", "2024"), ("Atalanta", "Bayern", "1-6"), ("Bayern", "Atalanta", "6-1"),
    ("Real Madrid", "Manchester City"), ("Manchester City", "Real Madrid"), ("Inter", "Juventus", "14 febbraio 2026"),
    ("Empoli", "Milan", "22 dicembre 2021"), ("Atalanta", "Milan", "13 maggio 2018"), ("Milan", "Genoa", "27 ottobre 2012"),
    ("Mondiale U-20", "2005"), ("Mondiale Under-20", "2005"),
]

ICONIC_NUMBERS = {7, 9, 10, 11, 45, 77, 80, 88, 99}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s).split())


def is_show_case(item: dict) -> bool:
    blob = json.dumps(item, ensure_ascii=False)
    return any(all(part in blob for part in fp) for fp in SHOW_FINGERPRINTS)


def notable_tm_ids(t: TM) -> set[int]:
    out = {pid_ for pid_, p in t.players.items() if p[6] and float(p[6]) >= 10_000_000}
    for pid_, apps, goals in t.q("""select player_id, count(*), sum(goals) from appearances
                                    where competition_id in ('IT1','GB1','ES1','L1','FR1','CL') group by 1"""):
        if apps >= 80 or (goals or 0) >= 20:
            out.add(int(pid_))
    return out


def replace_ids(x, mapping: dict[str, str]):
    if isinstance(x, dict):
        return {k: replace_ids(v, mapping) for k, v in x.items()}
    if isinstance(x, list):
        return [replace_ids(v, mapping) for v in x]
    if isinstance(x, str) and x in mapping:
        return mapping[x]
    return x


def finalize(packs: dict[str, list[dict]], entities: list[dict], graph_people: dict, qmap: dict[str, str]) -> tuple[dict, list[dict], dict]:
    t = TM(qmap)
    kinds = {e["id"]: e["kind"] for e in entities}
    # ---- notable ids
    notable: set[str] = set()
    for q, p in graph_people.items():
        if int(p.get("sitelinks") or 0) >= 15:
            notable.add(q)
    for pid_ in notable_tm_ids(t):
        notable.add(t.pid(pid_))
        notable.add(f"tm:p:{pid_}")
    # ---- unify sb:/wcp: ids by exact name with notable/known people
    by_name = defaultdict(set)
    for e in entities:
        if e["kind"] == "person" and not e["id"].startswith(("sb:", "wcp:", "intlp:")):
            by_name[norm(e["name"])].add(e["id"])
    mapping = {}
    for e in entities:
        if e["id"].startswith(("sb:", "wcp:")):
            cands = by_name.get(norm(e["name"]), set())
            if len(cands) == 1:
                mapping[e["id"]] = next(iter(cands))
    packs = replace_ids(packs, mapping)
    entities = [e for e in entities if e["id"] not in mapping]
    notable_names = {norm(e["name"]) for e in entities if e["id"] in notable}
    for e in entities:
        if e["id"].startswith(("sb:", "wcp:")) and norm(e["name"]) in notable_names:
            notable.add(e["id"])
        if e["id"].startswith("wcp:"):
            notable.add(e["id"])  # World Cup award winners are notable by definition
    name_of = {e["id"]: e["name"] for e in entities}

    def persons(ids):
        return [i for i in ids if kinds.get(i, "person" if i.startswith(("sb:", "tm:p:", "wcp:")) else "") == "person"]

    def ok_ids(ids) -> bool:
        ps = persons(ids)
        return all(p in notable for p in ps)

    stats = defaultdict(lambda: [0, 0, 0])  # kept, show, not notable
    out: dict[str, list[dict]] = {}
    for game, items in packs.items():
        keep = []
        for it in items:
            if is_show_case(it):
                stats[game][1] += 1
                continue
            good = True
            if game in ("maglia", "giramondo", "mercato"):
                good = ok_ids(it["answer"]["ids"])
                if game == "maglia" and good and it["generator"] == "tm_maglia":
                    good = it.get("_n", 30) >= 25 or (it.get("_n", 0) >= 10 and it["number"] in ICONIC_NUMBERS)
            elif game == "cassaforte":
                good = all(ok_ids(p["ids"]) for p in it["parts"] if p["kind"] == "entity")
            elif game in ("tiro_secco", "intruso"):
                good = ok_ids(it["entities"])
            elif game == "prima_pagina":
                good = ok_ids(it["slots"][0]["answer"].get("ids", []))
            elif game == "filo_rosso":
                good = ok_ids([it["from"]["id"], it["to"]["id"]])
            elif game == "frame" and it.get("lastScorer") and not ok_ids(it["lastScorer"]["ids"]):
                it.pop("lastScorer")
            if not good:
                stats[game][2] += 1
                continue
            it.pop("_n", None)
            stats[game][0] += 1
            keep.append(it)
        if game == "maglia":
            keep.sort(key=lambda x: -x["fame"])
            stats[game][2] += max(0, len(keep) - 1200)
            stats[game][0] = min(len(keep), 1200)
            keep = keep[:1200]
        out[game] = keep
    report = {g: {"kept": v[0], "excluded_show": v[1], "excluded_not_notable": v[2]} for g, v in stats.items()}
    del name_of
    return out, entities, report

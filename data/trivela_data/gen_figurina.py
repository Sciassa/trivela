"""Indovina la Figurina (SPEC §4.16): a player card covered up; who is it?

One profile per player with a licensed photo (assets build) and a card (gen_cards). Five clues, each one fills a line of
the card while the photo sharpens (frames from 3x4 to 30x40 pixels, see asset_build.FRAMES):
1. role; 2. nationality (and its flag); 3. the season of the card (the best one in the dataset) and its numbers; 4. the club of that season;
5. year of birth. The name, the real photo and its credit come out only at the reveal.
"""

from __future__ import annotations

from .gen_cards import build, photos
from .tm_core import SRC_DATASET, TM, base

LABELS = ("Ruolo", "Nazionalità", "Stagione", "Squadra in quella stagione", "Anno di nascita")


def generate(t: TM) -> dict[str, list[dict]]:
    ph = photos()
    cards = build(t, [int(k) for k, v in ph.items() if len(v.get("frames", [])) == 5])
    out = []
    for pid, rec in cards.items():
        c = rec["card"]
        dob = t.players[pid].get("dob")
        if not (c["nat"] and dob and c["photo"]):
            continue  # every clue must be there: a card with a gap would play with four
        st = c["stats"]
        values = (c["role"], c["nat"], f"{c['competition']} {c['season']} · {st['presenze']} presenze, {st['gol']} gol, {st['assist']} assist",
                  c["club"], str(dob.year))
        clues = [f"{k}: {v}" for k, v in zip(LABELS, values)]
        it = base(
            "figurina", pid, year=rec["season"], year_max=rec["last"], fame=t.fame(pid),
            entities=[t.pid(pid), f"comp:{rec['comp']}"], active=[rec["last"]],
            sources=[t.src_player(pid), SRC_DATASET,
                     {"family": "wikimedia", "label": c["credit"], "url": ph[str(pid)].get("page") or "https://commons.wikimedia.org"}],
            script=f"La figurina di {c['name']}: {c['role'].lower()}, {c['nat']}, nato nel {dob.year}. La sua stagione migliore nel "
                   f"dataset: {c['competition']} {c['season']} con il {c['club']}, {st['presenze']} presenze, {st['gol']} gol e "
                   f"{st['assist']} assist.")
        it.update({"clues": clues, "frames": ph[str(pid)]["frames"], "flag": c["flag"], "answer": t.answer(pid), "card": c})
        out.append(it)
    out.sort(key=lambda x: -x["fame"])
    return {"figurina": out}

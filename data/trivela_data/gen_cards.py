"""Player cards (SPEC §14.3, v16): an original pixel-art card for the players the questions are about.

Only real data: the player's best league season in the dataset (the most goals plus assists, at least 10 games for one
club, in a season whose appearance rows are complete), its club, role, competition; nationality and its flag; the pixel
photo when a licensed one exists (assets build), else the app draws a placeholder. No made-up rating.
Style, from objective thresholds only:
- «leggendaria»: at least 100 goals or 400 games in the dataset's top competitions (leagues, Champions, World Cup, Euro);
- «speciale»: the season on the card is a memorable one (the same rule as «Di chi è questa stagione?», SPEC §4.1);
- «classica»: every other card.
Written as 16 shards (player id modulo 16) under apps/web/public/data/cards/, fetched by the Screen only when a card is
shown.
"""

from __future__ import annotations

import json
from collections import defaultdict

from .gen_bandiere import flag_of
from .gen_seasons import LINE, Seasons, memorable
from .paths import PACKS_OUT, ROOT
from .tm_core import COMP_IT, POS_IT, TM, nat_it, season_label

SHARDS = 16
PHOTOS = ROOT / "static" / "photos.json"


def subjects(packs: dict[str, list[dict]]) -> set[int]:
    """The players the questions are about (one or two people per question, as in the draw)."""
    out = set()
    for items in packs.values():
        for it in items:
            people = [e for e in it.get("entities", []) if e.startswith("tm:p:")]
            if 0 < len(people) <= 2:
                out |= {int(p.split(":")[2]) for p in people}
            for i in (it.get("answer") or {}).get("ids", []) if isinstance(it.get("answer"), dict) else []:
                if i.startswith("tm:p:"):
                    out.add(int(i.split(":")[2]))
    return out


def build(t: TM, packs: dict[str, list[dict]]) -> dict[str, dict]:
    s = Seasons(t)
    best: dict[int, tuple] = {}
    for (comp, season), ok in s.ok.items():
        if not ok["apx"]:
            continue
        for pid, by_club in s.apx[(comp, season)].items():
            if len(by_club) != 1:
                continue
            club, (n, g, a) = next(iter(by_club.items()))
            if n < 10:
                continue
            k = (g + a, n, season)
            if pid not in best or k > best[pid][0]:
                best[pid] = (k, comp, season, club, n, g, a)
    photos = json.loads(PHOTOS.read_text(encoding="utf-8")) if PHOTOS.exists() else {}
    cards = {}
    for pid in sorted(subjects(packs)):
        if pid not in best or not t.is_notable(pid):
            continue
        _, comp, season, club, n, g, a = best[pid]
        pos = s.pos_of(comp, season, pid)
        role = POS_IT.get(pos)
        if not role:
            continue
        nat = t.players.get(pid, {}).get("nat")
        legend = t.goals_total.get(pid, 0) >= 100 or t.apps.get(pid, 0) >= 400
        style = "leggendaria" if legend else "speciale" if memorable(n, g, a, LINE.get(pos or "", "")) else "classica"
        ph = photos.get(str(pid))
        cards[str(pid)] = {"id": t.pid(pid), "name": t.pname(pid), "nat": nat_it(nat) if nat else None, "flag": flag_of(nat),
                           "club": t.club(club), "role": role, "season": season_label(season), "competition": COMP_IT[comp],
                           "stats": {"presenze": n, "gol": g, "assist": a}, "style": style,
                           "photo": ph["file"] if ph else None, "credit": ph["credit"] if ph else None}
    return cards


def write(t: TM, packs: dict[str, list[dict]]) -> dict:
    cards = build(t, packs)
    shards = defaultdict(dict)
    for pid, c in cards.items():
        shards[int(pid) % SHARDS][pid] = c
    out = PACKS_OUT / "cards"
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.json"):
        f.unlink()
    for k in range(SHARDS):
        (out / f"{k}.json").write_text(json.dumps(shards.get(k, {}), ensure_ascii=False, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    styles = defaultdict(int)
    for c in cards.values():
        styles[c["style"]] += 1
    return {"cards": len(cards), "with_photo": sum(1 for c in cards.values() if c["photo"]), "styles": dict(styles)}


if __name__ == "__main__":
    # from the published packs, so the cards always match the questions on the site
    from .generate import GAMES

    tm = TM()
    on_disk = {g: json.loads((PACKS_OUT / "games" / f"{g}.json").read_text(encoding="utf-8")) for g in GAMES}
    print(write(tm, on_disk))

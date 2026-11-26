"""Player cards (SPEC §14.3, v16): an original pixel-art card, the board of Indovina la Figurina (SPEC §4.16).

Only real data: the player's best league season in the dataset (the most goals plus assists, at least 10 games for one
club, in a season whose appearance rows are complete), its club, role, competition; nationality and its flag; the pixel
photo (assets build, licensed files only). No made-up rating.
Style, from objective thresholds only:
- «leggendaria»: at least 100 goals or 400 games in the dataset's top competitions (leagues, Champions, World Cup, Euro);
- «speciale»: the season on the card is a memorable one (the same rule as «Di chi è questa stagione?», SPEC §4.1);
- «classica»: every other card.
"""

from __future__ import annotations

import json

from .gen_bandiere import flag_of
from .gen_seasons import LINE, Seasons, memorable
from .paths import ROOT
from .tm_core import COMP_IT, POS_IT, TM, nat_it, season_label

PHOTOS = ROOT / "static" / "photos.json"


def photos() -> dict[str, dict]:
    return json.loads(PHOTOS.read_text(encoding="utf-8")) if PHOTOS.exists() else {}


def build(t: TM, pids, s: Seasons | None = None) -> dict[int, dict]:
    """The cards of these players: {pid: card + the facts behind it (comp, season year, club id, last season)}."""
    s = s or Seasons(t)
    wanted = {int(p) for p in pids}
    best: dict[int, tuple] = {}
    last: dict[int, int] = {}
    for (comp, season), ok in s.ok.items():
        if not ok["apx"]:
            continue
        for pid, by_club in s.apx[(comp, season)].items():
            if pid not in wanted:
                continue
            last[pid] = max(last.get(pid, 0), season)
            if len(by_club) != 1:
                continue
            club, (n, g, a) = next(iter(by_club.items()))
            if n < 10:
                continue
            k = (g + a, n, season)
            if pid not in best or k > best[pid][0]:
                best[pid] = (k, comp, season, club, n, g, a)
    ph = photos()
    cards = {}
    for pid in sorted(wanted):
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
        p = ph.get(str(pid))
        cards[pid] = {"card": {"id": t.pid(pid), "name": t.pname(pid), "nat": nat_it(nat) if nat else None, "flag": flag_of(nat),
                               "club": t.club(club), "role": role, "season": season_label(season), "competition": COMP_IT[comp],
                               "stats": {"presenze": n, "gol": g, "assist": a}, "style": style,
                               "photo": p["file"] if p else None, "credit": p["credit"] if p else None},
                      "comp": comp, "season": season, "last": last[pid]}
    return cards

"""Tiro Secco, «Trasferimento vero o falso?» (SPEC §4.1, v14): a player, from club A to club B, in a season.

- True: a real move from the transfers of the dataset (known player, at least one of the two clubs in a top-five league
  at the time).
- False: the same real move with the destination swapped for a club of the same league and standing that the player
  never joined in his whole history: no transfer to or from it, no appearance and no line-up with it. A move is never
  called false only because it is missing from the data.
- The loan / permanent variant is not made: the dataset has no explicit field for the kind of deal, and the fee does not
  prove it (a free transfer is not a loan).
"""

from __future__ import annotations

import random
from collections import defaultdict

from .gen_players import SKIP_CLUB
from .tm_core import L5, SRC_DATASET, TM, base, clean_club, season_label

MIN_FAME = 75
PER_PLAYER = 2


def generate(t: TM) -> dict[str, list[dict]]:
    comps = ",".join(f"'{c}'" for c in L5)
    league: dict[tuple[int, int], str] = {}
    by_league_season = defaultdict(set)
    for g in t.games(f"comp in ({comps})"):
        for c in (g["home"], g["away"]):
            league[(c, g["season"])] = g["comp"]
            by_league_season[(g["comp"], g["season"])].add(c)
    # the whole history of every player: clubs of his transfers, of his appearances and of his line-ups
    history = defaultdict(set)
    for pid, a, b in t.q("select player_id, from_club_id, to_club_id from transfers"):
        for c in (a, b):
            if c is not None:
                history[int(pid)].add(int(c))
    for pid, c in t.q("select distinct player_id, player_club_id from appearances where player_club_id is not null"):
        history[int(pid)].add(int(c))
    for pid, c in t.q("select distinct player_id, club_id from game_lineups where club_id is not null"):
        history[int(pid)].add(int(c))
    rows = t.q("""select player_id, transfer_date, from_club_id, to_club_id, from_club_name, to_club_name from transfers
                  where transfer_date <= date '2026-07-06' and from_club_id is not null and to_club_id is not null order by player_id, transfer_date""")
    moves = defaultdict(list)
    for pid, d, fc, tc, fn, tn in rows:
        pid, fc, tc = int(pid), int(fc), int(tc)
        if not t.is_notable(pid) or t.fame(pid) < MIN_FAME or fc == tc:
            continue
        if SKIP_CLUB.search(" ".join((fn or "").split())) or SKIP_CLUB.search(" ".join((tn or "").split())):
            continue
        season = d.year if d.month >= 6 else d.year - 1
        lg_to, lg_from = league.get((tc, season)), league.get((fc, season - 1 if d.month >= 6 else season))
        if not (lg_to or lg_from):
            continue
        moves[pid].append((d, season, fc, tc, lg_from, lg_to))
    out = []
    for pid, lst in sorted(moves.items()):
        r = random.Random(f"vf-{pid}")
        picks = r.sample(lst, min(PER_PLAYER, len(lst)))
        for k, (d, season, fc, tc, lg_from, lg_to) in enumerate(sorted(picks)):
            truth = (pid + k) % 2 == 0  # half true, half false, fixed by the player
            dest = tc
            if not truth:
                # same league and season as the real destination, never in the player's history, a club of similar standing
                lg = lg_to
                if not lg:
                    truth = True
                else:
                    pool = [c for c in by_league_season[(lg, season)] if c not in history[pid] and c not in (fc, tc)]
                    w = t.club_weight(tc)
                    pool.sort(key=lambda c: (abs(t.club_weight(c) - w), c))
                    if not pool:
                        truth = True
                    else:
                        dest = r.choice(pool[:3])
            frm, to = clean_club(t.club(fc)), clean_club(t.club(dest))
            sl = season_label(season)
            leagues = sorted({x for x in (lg_from, league.get((dest, season))) if x})
            q = f"{t.pname(pid)}: {t.da(fc)} {t.a(dest)}, stagione {sl}. Trasferimento vero o falso?"
            script = (f"Vero: {t.pname(pid)} è passato {t.da(fc)} {t.a(tc)} nella stagione {sl} (Transfermarkt)." if truth else
                      f"Falso: nella stagione {sl} {t.pname(pid)} è passato {t.da(fc)} {t.a(tc)}; {t.con(dest)} non ha mai giocato "
                      f"né firmato in tutta la sua carriera registrata.")
            it = base("ts_vero_falso" if "IT1" in leagues else "ts_vero_falso@estero", (pid, str(d), k), year=season, fame=t.fame(pid),
                      entities=[*(f"comp:{x}" for x in leagues), t.pid(pid), t.cid(fc), t.cid(dest)],
                      sources=[t.src_player(pid), SRC_DATASET], script=script)
            it.update({"question": q, "options": ["VERO", "FALSO"], "correct": 0 if truth else 1, "archetype": 5, "tag": "vf",
                       "transfer": {"player": t.pname(pid), "from": frm, "to": to, "season": sl}})
            out.append(it)
    # as many true as false moves: «always VERO» must not pay
    false = sorted((x for x in out if x["correct"] == 1), key=lambda x: (-x["fame"], x["id"]))
    true = sorted((x for x in out if x["correct"] == 0), key=lambda x: (-x["fame"], x["id"]))[:len(false)]
    return {"tiro_secco": sorted(true + false, key=lambda x: (-x["fame"], x["id"]))}

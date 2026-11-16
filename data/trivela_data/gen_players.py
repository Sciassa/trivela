"""Games on single players: Il Mercato, Il Giramondo, La Maglia."""

from __future__ import annotations

import re
from collections import Counter, defaultdict

from .tm_core import COMP_IT, IN_COMP, L5, POS_IT, SRC_DATASET, TM, articled, base, clean_club, fee_label, nat_it, season_label, window_label

ICONIC = {7, 9, 10, 11, 45, 77, 80, 88, 99}
SKIP_CLUB = re.compile(r"\b(U\d\d|Youth|Primavera|Retired|Without Club|Career break|Unknown|Ban|Juvenil|Sub-\d\d|Jgd|Yth)\b|\b(II|B)$", re.I)


# Il Mercato (SPEC §4.3, v11): about four transfers in five above 20 million (generator "mercato"); the cheaper ones
# ("mercato_minore") are rarer, drawn with the weights of the engine, and only for players who are well known.
BIG_FEE = 20_000_000
MINOR_FAME = 80


def mercato(t: TM, big_limit: int = 1500, minor_limit: int = 900) -> list[dict]:
    """A transfer worth at least 1 million in which the selling or the buying club played in a top-five league at the time.

    The `comp:` tags are those leagues, as they were in the season of the transfer (the seller in the season it was
    leaving, the buyer in the season the player joined): with only Serie A selected, every transfer comes from or goes to
    a Serie A club. Before 2012/13 the games are not in the dataset, so the club's league of today is used.
    """
    league: dict[tuple[int, int], str] = {}
    for g in t.games(f"comp in ({','.join(repr(c) for c in L5)})"):
        league[(g["home"], g["season"])] = g["comp"]
        league[(g["away"], g["season"])] = g["comp"]
    first = min(s for _, s in league)

    def league_of(club, season: int) -> str | None:
        if club is None:
            return None
        if season < first:
            lg = t.club_league.get(int(club))
            return lg if lg in L5 else None
        return league.get((int(club), season))

    rows = t.q("""select tr.player_id, tr.transfer_date, tr.from_club_id, tr.to_club_id, tr.from_club_name, tr.to_club_name, tr.transfer_fee
        from transfers tr where tr.transfer_fee >= 1000000 and tr.transfer_date >= date '1993-07-01' and tr.transfer_date <= date '2026-07-06'""")
    big, minor = [], []
    for pid, d, fc, tc, fn, tn, fee in rows:
        p = t.players.get(int(pid))
        if not p or not t.is_notable(pid) or not p["nat"] or not p["pos"] or not fn or not tn:
            continue
        season = d.year if d.month >= 6 else d.year - 1  # the season the player joined
        leagues = {league_of(tc, season), league_of(fc, season - 1 if d.month in (6, 7, 8, 9) else season)} - {None}
        if not leagues:
            continue  # neither club played in a top-five league then
        fee = round(float(fee) / 100_000) * 100_000  # as shown in the clue (one decimal): 19,96 million reads «20 mln €»
        if fee < BIG_FEE and t.fame(pid) < MINOR_FAME:
            continue  # a cheap transfer is asked only about a well-known player
        frm, to = t.club(fc, fn) if fc else clean_club(fn), t.club(tc, tn) if tc else clean_club(tn)
        clues = [fee_label(fee), window_label(d), POS_IT.get(p["pos"], p["pos"]), nat_it(p["nat"]),
                 f"Squadra cedente: {frm}", f"Squadra acquirente: {to}"]
        gen = "mercato" if fee >= BIG_FEE else "mercato_minore"
        it = base(gen, (pid, str(d)), year=d.year, fame=t.fame(pid), entities=[*(f"comp:{lg}" for lg in sorted(leagues)), t.pid(pid)],
                  sources=[t.src_player(pid)],
                  script=f"{t.pname(pid)} passò {articled('da', frm, False)} {articled('a', to, False)} ({window_label(d).lower()}) per {fee_label(fee)}, secondo Transfermarkt.")
        it.update({"clues": clues, "flag": p["nat"], "answer": t.answer(pid)})
        (big if gen == "mercato" else minor).append((fee * (1 + t.fame(pid)) if gen == "mercato" else t.fame(pid) * 1e9 + fee, it))
    big.sort(key=lambda x: (-x[0], x[1]["id"]))
    minor.sort(key=lambda x: (-x[0], x[1]["id"]))
    return [it for _, it in big[:big_limit]] + [it for _, it in minor[:minor_limit]]


def giramondo(t: TM, limit: int = 2000) -> list[dict]:
    """Career as the clubs in order of first arrival (with the year), split into five clues.

    Returns to a club already listed (end of a loan, second spell) are left out: the clue list reads as
    "where he went, in order", without the back-and-forth that made loan careers unreadable.
    """
    rows = t.q("""select player_id, transfer_date, to_club_id, to_club_name from transfers
                  where to_club_name is not null and transfer_date is not null and transfer_date <= date '2026-07-06' order by player_id, transfer_date""")
    careers = defaultdict(list)
    for pid, d, cid, cname in rows:
        careers[int(pid)].append((d, cid, cname))
    out = []
    for pid, steps in careers.items():
        if not t.is_notable(pid):
            continue
        clubs: list[tuple] = []
        leagues: set[str] = set()
        for d, cid, cname in steps:
            raw = " ".join((cname or "").split())
            if SKIP_CLUB.search(raw):
                continue
            name = t.club(cid, cname) if cid else clean_club(cname)
            if SKIP_CLUB.search(name):
                continue
            if cid and t.club_league.get(int(cid)) in L5:
                leagues.add(t.club_league[int(cid)])
            if all(c[1] != name for c in clubs):
                clubs.append((d, name))
        if len(clubs) < 4 or any(clubs[i][0] > clubs[i + 1][0] for i in range(len(clubs) - 1)):
            continue
        p = t.players[pid]
        n = len(clubs)
        step = lambda c: f"{c[0].year} {c[1]}"  # noqa: E731
        if n >= 5:
            sizes = [n // 5 + (1 if k < n % 5 else 0) for k in range(5)]
            clues, i = [], 0
            for sz in sizes:
                clues.append("; ".join(step(c) for c in clubs[i:i + sz]))
                i += sz
        else:
            clues = [step(c) for c in clubs]
            clues.insert(3, f"Ruolo: {POS_IT.get(p['pos'], p['pos'] or 'n.d.')} · nazionalità: {nat_it(p['nat'])}")
        it = base("giramondo", pid, year=clubs[0][0].year, year_max=clubs[-1][0].year, fame=t.fame(pid),
                  entities=[t.pid(pid), *(f"comp:{lg}" for lg in sorted(leagues))],
                  sources=[t.src_player(pid)], active=[clubs[-1][0].year],
                  script=f"La carriera di {t.pname(pid)}: le squadre in ordine di primo arrivo, con l'anno. " + " → ".join(step(c) for c in clubs) + ".")
        it.update({"clues": clues, "answer": t.answer(pid)})
        out.append(it)
    out.sort(key=lambda x: -x["fame"])
    return out[:limit]


def quotazione(t: TM, limit: int = 1500, min_points: int = 12, min_fame: int = 75) -> list[dict]:
    """La Quotazione (SPEC §4.11): a known player's market value over time, with a flag at each change of club.

    The curve is revealed a quarter at a time; then the names of the clubs on the flags, then role and nationality.
    Values from `player_valuations` up to the snapshot (6 July 2026), in millions of euro.
    """
    rows = t.q("""select player_id, date, market_value_in_eur, current_club_id, current_club_name, player_club_domestic_competition_id
                  from player_valuations where date <= date '2026-07-06' and market_value_in_eur > 0 order by player_id, date""")
    per: dict[int, list] = defaultdict(list)
    for pid, d, v, cid, cname, lg in rows:
        if t.is_notable(pid):
            per[int(pid)].append((d, float(v), cid, cname, lg))
    out = []
    for pid, pts in per.items():
        p = t.players.get(pid)
        if len(pts) < min_points or t.fame(pid) < min_fame or not p or not p["pos"] or not p["nat"]:
            continue
        leagues = {x[4] for x in pts} & set(L5)
        if not leagues:
            continue
        moves: list[tuple] = []  # (date, club name): the club of the first value, then every change
        for d, _v, cid, cname, _lg in pts:
            name = t.club(cid, cname) if cid else clean_club(cname or "")
            if not name or SKIP_CLUB.search(name) or (moves and moves[-1][1] == name):
                continue
            moves.append((d, name))
        if len({m[1] for m in moves}) < 2:
            continue
        year = lambda d: round(d.year + (d.timetuple().tm_yday - 1) / 366, 2)  # noqa: E731
        curve = [{"t": year(d), "v": max(0.01, round(v / 1e6, 2))} for d, v, *_ in pts]  # millions; a youth value of 25k is 0.03
        peak_d, peak_v, *_ = max(pts, key=lambda x: (x[1], -x[0].toordinal()))
        peak_club = next((m[1] for m in reversed(moves) if m[0] <= peak_d), moves[0][1])
        last_d, last_v, *_ = pts[-1]
        clues = ["Il primo quarto della curva", "Metà della curva", "Tre quarti della curva",
                 f"La curva intera: picco di {fee_label(peak_v)} nel {peak_d.year}",
                 "Squadre: " + " → ".join(m[1] for m in moves),
                 f"{POS_IT.get(p['pos'], p['pos'])} · {nat_it(p['nat'])}"]
        it = base("quotazione", pid, year=pts[0][0].year, year_max=last_d.year, fame=t.fame(pid),
                  entities=[*(f"comp:{lg}" for lg in sorted(leagues)), t.pid(pid)], sources=[t.src_player(pid), SRC_DATASET],
                  active=[last_d.year],
                  script=f"La quotazione di {t.pname(pid)} secondo Transfermarkt: picco di {fee_label(peak_v)} nel {peak_d.year} "
                         f"{articled('con', peak_club)}; {len(pts)} valutazioni dal {pts[0][0].year}, "
                         f"l'ultima di {fee_label(last_v)} ({window_label(last_d).lower()}).")
        it.update({"clues": clues, "curve": curve, "moves": [{"t": year(d), "club": c} for d, c in moves], "answer": t.answer(pid)})
        out.append(it)
    out.sort(key=lambda x: (-x["fame"], x["id"]))
    return out[:limit]


# Shirt numbers by the role that usually wears them: a number outside its role is an "anomaly".
GROUP = {"Goalkeeper": "GK", "Centre-Back": "DEF", "Left-Back": "DEF", "Right-Back": "DEF", "Sweeper": "DEF", "Defender": "DEF",
         "Defensive Midfield": "MID", "Central Midfield": "MID", "midfield": "MID", "Midfield": "MID", "Right Midfield": "MID",
         "Left Midfield": "MID", "Attacking Midfield": "MID", "Right Winger": "ATT", "Left Winger": "ATT", "Centre-Forward": "ATT",
         "Second Striker": "ATT", "Attack": "ATT"}
CLASSIC = {1: {"GK"}, 2: {"DEF", "MID"}, 3: {"DEF", "MID"}, 4: {"DEF", "MID"}, 5: {"DEF", "MID"}, 6: {"DEF", "MID"}, 7: {"ATT", "MID"},
           8: {"MID", "ATT"}, 9: {"ATT"}, 10: {"MID", "ATT"}, 11: {"ATT", "MID"}}
ROLE_IT = {"GK": "portiere", "DEF": "difensore", "MID": "centrocampista", "ATT": "attaccante"}


def maglia_kind(num: int, group: str) -> str | None:
    """None: banal (1 for a goalkeeper, 9 for a forward); otherwise a number out of its role, a heavy number (20+) or a plain one."""
    if num == 1 and group == "GK" or num == 9 and group == "ATT":
        return None
    if num in CLASSIC and group not in CLASSIC[num]:
        return "anomala"  # e.g. a defender wearing the 10, a goalkeeper the 8
    if num in CLASSIC:
        return "classica"
    return "pesante" if num >= 20 else "insolita"  # 20 and up: 21, 22, 45, 77, 99...; 12 to 19: squad numbers


def maglia(t: TM, classic_share: float = 0.02) -> list[dict]:
    """Player + club + season -> shirt number worn (at least 25 league games with it, 10 for iconic numbers).

    No banal number (1 for goalkeepers, 9 for centre-forwards); the unusual ones and the numbers worn out of role come first.
    """
    comps = ",".join(f"'{c}'" for c in L5)
    rows = t.q(f"""select gm.comp, gm.season, l.club, l.pid, l.num, l.starter, l.pos, count(*) from lu l join gm using(gid)
                   where gm.comp in ({comps}) and l.num is not null group by 1, 2, 3, 4, 5, 6, 7""")
    per, roles = defaultdict(Counter), defaultdict(Counter)
    for comp, season, club, pid, num, starter, pos, n in rows:
        key = (comp, int(season), int(club), int(pid))
        per[key][int(num)] += int(n)
        if starter and pos in GROUP:
            roles[key][GROUP[pos]] += int(n)
    found: dict[str, list[dict]] = {"anomala": [], "pesante": [], "insolita": [], "classica": []}
    for (comp, season, club, pid), c in per.items():
        if not t.is_notable(pid) or len(c) != 1 or not roles[(comp, season, club, pid)]:
            continue  # one single number in the whole season, no ambiguity
        (num, n), = c.items()
        if not 1 <= num <= 99:
            continue
        group = roles[(comp, season, club, pid)].most_common(1)[0][0]
        kind = maglia_kind(num, group)
        if kind is None:
            continue
        # a number out of its role is rare enough to be worth 12 games; the others need a full season
        if not (n >= 25 or (n >= 10 and num in ICONIC) or (kind == "anomala" and n >= 12)):
            continue
        # three generators (drawn evenly): out of role, heavy numbers, and squad numbers with a few classic ones (2%)
        gen = {"anomala": "maglia_anomala", "pesante": "maglia_pesante"}.get(kind, "maglia_numero")
        it = base(gen if comp == "IT1" else f"{gen}@estero", (comp, season, club, pid), year=season, fame=t.fame(pid),
                  entities=[f"comp:{comp}", t.cid(club), t.pid(pid)], sources=[t.src_player(pid), SRC_DATASET],
                  script=f"Nella {COMP_IT[comp]} {season_label(season)} {t.pname(pid)} ({ROLE_IT[group]}) indossava il numero {num} {t.di(club)}.")
        it.update({"player": t.pname(pid), "team": t.club(club), "season": f"{COMP_IT[comp]} {season_label(season)}",
                   "question": f"Che numero di maglia aveva {t.pname(pid)} {t.con(club)} nella {COMP_IT[comp]} {season_label(season)}?",
                   "answer": {"kind": "number", "value": num, "display": str(num)}, "role": group, "player_id": pid})
        it["_n"] = n
        found[kind].append(it)
    found = {k: _one_per_shirt(v) for k, v in found.items()}
    for v in found.values():
        v.sort(key=lambda x: (-x["fame"], x["id"]))
    classic = found["classica"][: int(len(found["insolita"]) * classic_share)]
    out = sorted(found["anomala"] + found["pesante"] + found["insolita"] + classic, key=lambda x: (-x["fame"], x["id"]))
    # at most MAX_PER_PLAYER questions on the same player, out-of-role numbers first: a pack where one player
    # fills five slots makes him come back match after match (SPEC §4.8)
    rank = {"maglia_anomala": 0, "maglia_pesante": 1, "maglia_numero": 2}
    per_player: Counter = Counter()
    kept = []
    for it in sorted(out, key=lambda x: (rank[x["generator"].split("@")[0]], -x["fame"], x["id"])):
        if per_player[it["player_id"]] >= MAX_PER_PLAYER:
            continue
        per_player[it["player_id"]] += 1
        kept.append(it)
    for it in kept:
        del it["player_id"]
    return sorted(kept, key=lambda x: (-x["fame"], x["id"]))


MAX_PER_PLAYER = 2


def _one_per_shirt(items: list[dict]) -> list[dict]:
    """Same player, same club, same number in several seasons is one question, not five: keep the season with most games."""
    best: dict[tuple, dict] = {}
    for it in items:
        k = (it["player_id"], it["team"], it["answer"]["value"])
        if k not in best or (it["_n"], -it["yearMax"]) > (best[k]["_n"], -best[k]["yearMax"]):
            best[k] = it
    for it in best.values():
        del it["_n"]
    return list(best.values())


def generate(t: TM) -> dict[str, list[dict]]:
    return {"mercato": mercato(t), "giramondo": giramondo(t), "maglia": maglia(t), "quotazione": quotazione(t)}


__all__ = ["generate", "IN_COMP"]

"""Games on single players: Il Mercato, Il Giramondo, La Maglia."""

from __future__ import annotations

import re
from collections import Counter, defaultdict

from .tm_core import COMP_IT, IN_COMP, L5, POS_IT, SRC_DATASET, TM, base, clean_club, fee_label, nat_it, season_label, window_label

ICONIC = {7, 9, 10, 11, 45, 77, 80, 88, 99}
SKIP_CLUB = re.compile(r"\b(U\d\d|Youth|Primavera|Retired|Without Club|Career break|Unknown|Ban|Juvenil|Sub-\d\d|Jgd|Yth)\b|\b(II|B)$", re.I)


def mercato(t: TM, limit: int = 2500) -> list[dict]:
    rows = t.q("""select tr.player_id, tr.transfer_date, tr.from_club_id, tr.to_club_id, tr.from_club_name, tr.to_club_name, tr.transfer_fee
        from transfers tr left join clubs cf on cf.club_id = tr.from_club_id left join clubs ct on ct.club_id = tr.to_club_id
        where tr.transfer_fee >= 1000000 and tr.transfer_date >= date '1993-07-01' and tr.transfer_date <= date '2026-07-06'
          and (cf.domestic_competition_id = 'IT1' or ct.domestic_competition_id = 'IT1')""")
    out = []
    for pid, d, fc, tc, fn, tn, fee in rows:
        p = t.players.get(int(pid))
        if not p or not t.is_notable(pid) or not p["nat"] or not p["pos"] or not fn or not tn:
            continue
        frm, to = t.club(fc, fn) if fc else clean_club(fn), t.club(tc, tn) if tc else clean_club(tn)
        clues = [fee_label(float(fee)), window_label(d), POS_IT.get(p["pos"], p["pos"]), nat_it(p["nat"]),
                 f"Squadra cedente: {frm}", f"Squadra acquirente: {to}"]
        it = base("mercato", (pid, str(d)), year=d.year, fame=t.fame(pid), entities=["comp:IT1", t.pid(pid)],
                  sources=[t.src_player(pid)],
                  script=f"{t.pname(pid)} passò da {frm} a {to} ({window_label(d).lower()}) per {fee_label(float(fee))}, secondo Transfermarkt.")
        it.update({"clues": clues, "flag": p["nat"], "answer": t.answer(pid)})
        out.append((float(fee) * (1 + t.fame(pid)), it))
    out.sort(key=lambda x: -x[0])
    return [it for _, it in out[:limit]]


def giramondo(t: TM, limit: int = 2000) -> list[dict]:
    """Careers in strict chronological order, split into five clues."""
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
        for d, cid, cname in steps:
            raw = " ".join((cname or "").split())
            if SKIP_CLUB.search(raw):
                continue
            name = t.club(cid, cname) if cid else clean_club(cname)
            if SKIP_CLUB.search(name):
                continue
            if not clubs or clubs[-1][1] != name:
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
                clues.append(" → ".join(step(c) for c in clubs[i:i + sz]))
                i += sz
        else:
            clues = [step(c) for c in clubs]
            clues.insert(3, f"Ruolo: {POS_IT.get(p['pos'], p['pos'] or 'n.d.')} · nazionalità: {nat_it(p['nat'])}")
        it = base("giramondo", pid, year=clubs[0][0].year, year_max=clubs[-1][0].year, fame=t.fame(pid), entities=[t.pid(pid)],
                  sources=[t.src_player(pid)], active=[clubs[-1][0].year],
                  script=f"La carriera di {t.pname(pid)} in ordine cronologico (anno del trasferimento): " + " → ".join(step(c) for c in clubs) + ".")
        it.update({"clues": clues, "answer": t.answer(pid)})
        out.append(it)
    out.sort(key=lambda x: -x["fame"])
    return out[:limit]


def maglia(t: TM, limit: int = 1500) -> list[dict]:
    """Player + club + season -> shirt number worn (at least 25 league games with it, 10 for iconic numbers)."""
    comps = ",".join(f"'{c}'" for c in L5)
    rows = t.q(f"""select gm.comp, gm.season, l.club, l.pid, l.num, count(*) from lu l join gm using(gid)
                   where gm.comp in ({comps}) and l.num is not null group by 1, 2, 3, 4, 5""")
    per = defaultdict(Counter)
    for comp, season, club, pid, num, n in rows:
        per[(comp, int(season), int(club), int(pid))][int(num)] += int(n)
    out = []
    for (comp, season, club, pid), c in per.items():
        if not t.is_notable(pid) or len(c) != 1:
            continue  # one single number in the whole season, no ambiguity
        (num, n), = c.items()
        if not (n >= 25 or (n >= 10 and num in ICONIC)) or not 1 <= num <= 99:
            continue
        it = base("maglia" if comp == "IT1" else "maglia@estero", (comp, season, club, pid), year=season, fame=t.fame(pid),
                  entities=[f"comp:{comp}", t.cid(club), t.pid(pid)], sources=[t.src_player(pid), SRC_DATASET],
                  script=f"Nella {COMP_IT[comp]} {season_label(season)} {t.pname(pid)} indossava il numero {num} {t.di(club)}.")
        it.update({"player": t.pname(pid), "team": t.club(club), "season": f"{COMP_IT[comp]} {season_label(season)}",
                   "question": f"Che numero di maglia aveva {t.pname(pid)} {t.con(club)} nella {COMP_IT[comp]} {season_label(season)}?",
                   "answer": {"kind": "number", "value": num, "display": str(num)}})
        out.append(it)
    out.sort(key=lambda x: (-x["fame"], x["id"]))
    ita = [x for x in out if x["generator"] == "maglia"][:limit]
    est = [x for x in out if x["generator"] != "maglia"][: limit // 3]
    return ita + est


def generate(t: TM) -> dict[str, list[dict]]:
    return {"mercato": mercato(t), "giramondo": giramondo(t), "maglia": maglia(t)}


__all__ = ["generate", "IN_COMP"]

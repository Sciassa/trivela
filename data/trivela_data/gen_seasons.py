"""Three families of Tiro Secco questions on one competition and one season (SPEC §4.1, v15).

- «Di chi è questa stagione?» (tag "scheda"): a memorable league season of a player as a card (games, goals, assists,
  role); four options, the wrong ones are players of the same role with close numbers in the same season.
- «Stagione dei campioni» (tag "campioni"): champion, top scorer, top assist man, goalkeeper with most clean sheets, best
  attack and best defence of a league season, and the same questions on one club (top scorer, most games, top
  assists, final place).
- «Chi ne ha fatti di più?» (tag "confronto"): in one league season, which of four players scored the most goals, gave
  the most assists or got the most yellow cards; the four values are close and never tied.

Until v14 the first two were games of their own (Le Statistiche, La Stagione dei Campioni).

Only closed perimeters: a league season enters when every game is in the dataset (each club plays every other twice)
and, for each kind of statistic, when every game carries the data it needs:
- results and goals: the events add up with the score (`g_goal_ok`);
- appearances and assists: every game has the appearance rows of both teams, and their goals add up with the score;
- clean sheets: complete line-ups and minutes on top of that.
Final places come from the club positions Transfermarkt records on the last matchday (point deductions included), and
are used only where they agree with the table computed from the results. Ties at the top are never asked.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict

from .gen_lists import scope
from .tm_core import COMP_IT, IN_COMP, L5, OF_COMP, POS_IT, SRC_DATASET, TM, base, nat_it, opts4, season_label

STAT_MIN_FAME = 70
STAT_MIN_GAMES = 20
STAT_PER_PLAYER = 2
CAP_SCHEDA = 900
CAP_CONFRONTO = 300  # per statistic
LINE = {"Goalkeeper": "GK", "Centre-Back": "DEF", "Right-Back": "DEF", "Left-Back": "DEF", "Sweeper": "DEF", "Defender": "DEF",
        "Defensive Midfield": "MID", "Central Midfield": "MID", "Attacking Midfield": "MID", "Right Midfield": "MID",
        "Left Midfield": "MID", "midfield": "MID", "Midfield": "MID", "Right Winger": "ATT", "Left Winger": "ATT",
        "Centre-Forward": "ATT", "Second Striker": "ATT", "Attack": "ATT"}


def memorable(n: int, g: int, a: int, line: str) -> bool:
    """A season worth remembering: «0 games, 0 goals» says nothing about anybody."""
    return n >= STAT_MIN_GAMES and (g >= 15 or a >= 10 or g + a >= 20 or (line == "DEF" and g >= 5) or (line == "MID" and g + a >= 14))


def cap(s: str) -> str:
    """Upper-case the first letter only: «della Ligue 1» -> «Della Ligue 1» (str.capitalize would lower «Ligue»)."""
    return s[:1].upper() + s[1:]


def gid_of(name: str, comp: str) -> str:
    return name if comp == "IT1" else f"{name}@estero"


class Seasons:
    def __init__(self, t: TM):
        self.t = t
        comps = ",".join(f"'{c}'" for c in L5)
        q = t.q
        self.games = defaultdict(list)  # (comp, season) -> games
        for g in t.games(f"comp in ({comps})"):
            self.games[(g["comp"], g["season"])].append(g)
        goal_ok = {int(r[0]) for r in q("select gid from g_goal_ok")}
        lu_ok = {int(r[0]) for r in q("select gid from g_lu_ok")}
        apx_ok = {int(r[0]) for r in q(f"""select gm.gid from gm join apchk k using(gid)
            where gm.comp in ({comps}) and k.n >= 22 and not gm.pens and k.tot = gm.hg + gm.ag""")}
        self.ok: dict[tuple, dict[str, bool]] = {}
        for key, gs in self.games.items():
            clubs = {g["home"] for g in gs} | {g["away"] for g in gs}
            n = len(clubs)
            per = Counter([g["home"] for g in gs] + [g["away"] for g in gs])
            full = len(gs) == n * (n - 1) and all(per[c] == 2 * (n - 1) for c in clubs)
            ids = {g["gid"] for g in gs}
            self.ok[key] = {"full": full, "goals": full and ids <= goal_ok, "apx": full and ids <= apx_ok,
                            "lu": full and ids <= apx_ok and ids <= lu_ok}
        # appearance rows: (comp, season) -> pid -> club -> [games, goals, assists]
        self.apx = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0, 0])))
        for comp, season, pid, club, n, g, a in q(f"""select gm.comp, gm.season, a.pid, a.club, count(*), sum(a.goals), sum(a.assists)
                from apx a join gm using(gid) where gm.comp in ({comps}) group by 1, 2, 3, 4"""):
            self.apx[(comp, int(season))][int(pid)][int(club)] = [int(n), int(g or 0), int(a or 0)]
        # verified goals (events, or appearances where they add up): (comp, season) -> pid -> club -> goals
        self.goals = defaultdict(lambda: defaultdict(Counter))
        for comp, season, pid, club, n in q(f"select gm.comp, gm.season, pg.pid, pg.club, sum(pg.goals) from pg join gm using(gid) where gm.comp in ({comps}) group by 1, 2, 3, 4"):
            self.goals[(comp, int(season))][int(pid)][int(club)] += int(n)
        # the role played that season: the most frequent position as a starter
        self.role = defaultdict(Counter)
        for comp, season, pid, pos, n in q(f"""select gm.comp, gm.season, l.pid, l.pos, count(*) from lu l join gm using(gid)
                where l.starter and gm.comp in ({comps}) and l.pos is not null and l.pos <> '' group by 1, 2, 3, 4"""):
            self.role[(comp, int(season), int(pid))][pos] += int(n)
        # last-matchday positions recorded by Transfermarkt: (comp, season) -> club -> place
        self.place = defaultdict(dict)
        for comp, season, club, pos in q(f"""with last as (select competition_id comp, season, max(date) d from games
                    where competition_id in ({comps}) group by 1, 2)
                select g.competition_id, g.season, g.home_club_id, g.home_club_position from games g join last l
                    on l.comp = g.competition_id and l.season = g.season and g.date >= l.d - interval 3 day
                union all
                select g.competition_id, g.season, g.away_club_id, g.away_club_position from games g join last l
                    on l.comp = g.competition_id and l.season = g.season and g.date >= l.d - interval 3 day"""):
            if pos is not None and club is not None:
                self.place[(comp, int(season))][int(club)] = int(pos)

    # ------------------------------------------------------------------ helpers
    def pos_of(self, comp: str, season: int, pid: int) -> str | None:
        """The position played that season (the most frequent as a starter), else the one of his profile."""
        c = self.role.get((comp, season, pid))
        return c.most_common(1)[0][0] if c else self.t.players.get(pid, {}).get("pos")

    def role_of(self, comp: str, season: int, pid: int) -> str | None:
        return POS_IT.get(self.pos_of(comp, season, pid))

    def table(self, comp: str, season: int) -> dict[int, dict]:
        """Points, goals for and against from the results (computed), with the recorded final place."""
        tab = defaultdict(lambda: {"pts": 0, "gf": 0, "ga": 0})
        for g in self.games[(comp, season)]:
            h, a, hg, ag = g["home"], g["away"], g["hg"], g["ag"]
            tab[h]["gf"] += hg
            tab[h]["ga"] += ag
            tab[a]["gf"] += ag
            tab[a]["ga"] += hg
            tab[h]["pts"] += 3 if hg > ag else 1 if hg == ag else 0
            tab[a]["pts"] += 3 if ag > hg else 1 if hg == ag else 0
        for c, row in tab.items():
            row["place"] = self.place[(comp, season)].get(c)
        return tab

    @staticmethod
    def top(values: dict, k: int = 4):
        """The k best by value, only when the first is alone at the top: ties at the top are never asked."""
        best = sorted(values.items(), key=lambda kv: (-kv[1], kv[0]))
        if len(best) < k or best[0][1] == best[1][1]:
            return None
        return best[:k]

    # ------------------------------------------------------------------ «Di chi è questa stagione?»
    def season_rows(self, comp: str, season: int) -> dict[int, tuple]:
        """Every player of one league season: (games, goals, assists, position, nationality, clubs)."""
        t = self.t
        out = {}
        for pid, by_club in self.apx[(comp, season)].items():
            n, g, a = (sum(v[i] for v in by_club.values()) for i in range(3))
            out[pid] = (n, g, a, self.pos_of(comp, season, pid), t.players.get(pid, {}).get("nat"), len(by_club))
        return out

    def scheda(self) -> list[dict]:
        t = self.t
        cards: dict[int, list] = defaultdict(list)
        for (comp, season), ok in sorted(self.ok.items()):
            if not ok["apx"]:
                continue
            rows = self.season_rows(comp, season)
            # every player of that league season, to prove that the card points at one man only
            keyed: Counter = Counter()
            for pid, (n, g, a, pos, nat, _clubs) in rows.items():
                keyed[(n, g, a, POS_IT.get(pos))] += 1
                keyed[(n, g, a, POS_IT.get(pos), nat)] += 1
            for pid, (n, g, a, pos, nat, clubs) in rows.items():
                role, line = POS_IT.get(pos), LINE.get(pos or "")
                if clubs != 1 or not role or not line or line == "GK" or not t.is_notable(pid) or t.fame(pid) < STAT_MIN_FAME:
                    continue
                if not memorable(n, g, a, line):
                    continue
                if sum(self.goals[(comp, season)].get(pid, {}).values()) != g:
                    continue  # the goals of the card are the verified ones too
                with_nat = keyed[(n, g, a, role)] > 1
                if with_nat and (not nat or keyed[(n, g, a, role, nat)] > 1):
                    continue  # two players with the very same card: not asked
                # the wrong options: players of the same role (else line) of that season with the closest numbers
                near = []
                for q, (n2, g2, a2, pos2, _nat2, _c2) in rows.items():
                    if q == pid or not t.is_notable(q) or n2 < 15 or LINE.get(pos2 or "") != line:
                        continue
                    if (g2, a2) == (g, a):
                        continue  # the same goals and assists: the card would hinge on the games alone
                    dist = abs(g2 - g) + 0.8 * abs(a2 - a) + 0.15 * abs(n2 - n) + (0 if pos2 == pos else 2)
                    near.append((dist, abs(t.fame(q) - t.fame(pid)), q))
                near.sort()
                if len(near) < 3:
                    continue
                club = next(iter(self.apx[(comp, season)][pid]))
                cards[pid].append((g + a, n, comp, season, g, a, role, nat if with_nat else None, club, [q for _, _, q in near[:3]]))
        out = []
        for pid, lst in cards.items():
            for _, n, comp, season, g, a, role, nat, club, wrong in sorted(lst, key=lambda x: (-x[0], -x[1], x[3]))[:STAT_PER_PLAYER]:
                lab = f"{COMP_IT[comp]} {season_label(season)}"
                key = (pid, comp, season)
                o = opts4(t.pname(pid), [t.pname(q) for q in wrong], f"ts_scheda-{key}")
                if not o:
                    continue
                others = "; ".join(f"{t.pname(q)} {sum(v[1] for v in self.apx[(comp, season)][q].values())} gol, "
                                   f"{sum(v[2] for v in self.apx[(comp, season)][q].values())} assist" for q in wrong)
                it = base(gid_of("ts_scheda", comp), key, year=season, fame=t.fame(pid),
                          entities=[f"comp:{comp}", t.pid(pid), t.cid(club)], sources=[t.src_player(pid), SRC_DATASET],
                          script=f"{t.pname(pid)} {t.con(club)}, {lab}: {n} presenze, {g} gol e {a} assist in campionato "
                                 f"({role.lower()}). Gli altri, quella stagione: {others}. Solo {COMP_IT[comp]}; dati Transfermarkt.")
                it.update({"question": "Di chi è questa stagione?", "options": o[0], "correct": o[1], "archetype": 2, "tag": "scheda",
                           "card": {"season": season_label(season), "competition": COMP_IT[comp], "scope": f"Solo {COMP_IT[comp]}",
                                    "stats": {"presenze": n, "gol": g, "assist": a}, "role": role, "nat": nat_it(nat) if nat else None}})
                out.append(it)
        out.sort(key=lambda x: (-x["fame"], x["id"]))
        return out[:CAP_SCHEDA]

    # ------------------------------------------------------------------ «Chi ne ha fatti di più?»
    def confronto(self) -> list[dict]:
        t = self.t
        comps = ",".join(f"'{c}'" for c in L5)
        # yellow cards: a player counts only when his appearance rows agree with his card events in that season
        yc = defaultdict(Counter)
        for comp, season, pid, n in t.q(f"select gm.comp, gm.season, a.pid, sum(a.yc) from apx a join gm using(gid) where gm.comp in ({comps}) group by 1, 2, 3"):
            yc[(comp, int(season))][int(pid)] = int(n or 0)
        ev_y = defaultdict(Counter)
        for comp, season, pid, n in t.q(f"""select gm.comp, gm.season, e.pid, count(*) from ev e join gm using(gid)
                where e.type = 'Cards' and e.descr ilike '%yellow card%' and e.pid is not null and gm.comp in ({comps}) group by 1, 2, 3"""):
            ev_y[(comp, int(season))][int(pid)] = int(n)
        kinds = (("gol", "ha segnato più gol", 1, 10, 6, ("ATT", "MID")), ("assist", "ha fornito più assist", 2, 7, 4, ("ATT", "MID")),
                 ("gialli", "ha ricevuto più cartellini gialli", None, 8, 4, ("DEF", "MID")))
        out = []
        for stat, what, idx, floor, span, lines in kinds:
            made = []
            for (comp, season), ok in sorted(self.ok.items()):
                if not ok["apx"]:
                    continue
                rows = self.season_rows(comp, season)
                val = {p: (yc[(comp, season)][p] if idx is None else r[idx]) for p, r in rows.items()
                       if t.is_notable(p) and t.fame(p) >= STAT_MIN_FAME and r[0] >= 15 and LINE.get(r[3] or "") in lines
                       and (idx is not None or yc[(comp, season)][p] == ev_y[(comp, season)][p])}
                used: set[int] = set()
                for anchor in sorted(val, key=lambda p: (-val[p], -t.fame(p), p))[:8]:
                    v = val[anchor]
                    if v < floor or anchor in used:
                        continue
                    # three players a little below, with three different values: close, never tied
                    pool = [p for p in val if p != anchor and p not in used and v - span <= val[p] < v]
                    pool.sort(key=lambda p: (abs(t.fame(p) - t.fame(anchor)), p))
                    picks, seen = [], {v}
                    for p in pool:
                        if val[p] not in seen:
                            picks.append(p)
                            seen.add(val[p])
                        if len(picks) == 3:
                            break
                    if len(picks) < 3:
                        continue
                    used |= {anchor, *picks}
                    lab = f"{COMP_IT[comp]} {season_label(season)}"
                    key = (stat, comp, season, anchor)
                    o = opts4(t.pname(anchor), [t.pname(p) for p in picks], f"ts_confronto-{key}")
                    unit = {"gol": "gol", "assist": "assist", "gialli": "gialli"}[stat]
                    ranking = sorted([anchor, *picks], key=lambda p: -val[p])
                    it = base(gid_of(f"ts_confronto_{stat}", comp), key, year=season, fame=t.fame(anchor),
                              entities=[f"comp:{comp}", t.pid(anchor), *(t.pid(p) for p in picks)], sources=[SRC_DATASET],
                              script=f"{cap(lab)}, solo campionato: " + ", ".join(f"{t.pname(p)} {val[p]} {unit}" for p in ranking)
                                     + ". Dati Transfermarkt.")
                    it.update({"question": f"{lab}: quale di questi giocatori {what} in campionato?", "options": o[0], "correct": o[1],
                               "archetype": 2, "tag": "confronto"})
                    made.append(it)
            made.sort(key=lambda x: (-x["fame"], x["id"]))
            out += made[:CAP_CONFRONTO]
        return out

    # ------------------------------------------------------------------ La Stagione dei Campioni
    def add(self, out, gen, key, comp, season, question, correct, wrong, script, entities, fame=70):
        o = opts4(correct, wrong, f"{gen}-{key}")
        if not o:
            return
        it = base(gid_of(gen, comp), key, year=season, fame=fame, entities=[f"comp:{comp}", *entities], sources=[SRC_DATASET], script=script)
        it.update({"question": question, "options": o[0], "correct": o[1], "archetype": 2, "tag": "campioni"})
        out.append(it)

    def stagione(self) -> list[dict]:
        t = self.t
        out: list[dict] = []
        for (comp, season), ok in sorted(self.ok.items()):
            if not ok["full"]:
                continue
            lab = f"{OF_COMP[comp]} {season_label(season)}"
            tab = self.table(comp, season)
            clubs = list(tab)
            # champion: first by points from the results and first in the recorded final table, alone
            pts = {c: r["pts"] for c, r in tab.items()}
            rank = self.top(pts)
            if rank and tab[rank[0][0]]["place"] == 1 and all(r["place"] for r in tab.values()):
                champ = rank[0][0]
                wrong = [t.club(c) for c, _ in rank[1:4]]
                self.add(out, "stg_campione", (comp, season), comp, season, f"Chi ha vinto la {COMP_IT[comp]} {season_label(season)}?",
                         t.club(champ), wrong, f"{t.club(champ)} campione {lab} con {pts[champ]} punti; "
                         + ", ".join(f"{t.club(c)} {p}" for c, p in rank[1:4]) + ".", [t.cid(champ)], fame=80)
            for gen, field, best, what in (("stg_attacco", "gf", max, "ha segnato più gol"), ("stg_difesa", "ga", min, "ha subito meno gol")):
                vals = {c: (r[field] if best is max else -r[field]) for c, r in tab.items()}
                r4 = self.top(vals)
                if r4:
                    c0 = r4[0][0]
                    self.add(out, gen, (comp, season), comp, season, f"Quale squadra {what} {lab}?", t.club(c0),
                             [t.club(c) for c, _ in r4[1:4]],
                             f"{cap(lab)}: {t.club(c0)} {abs(r4[0][1])} gol {'fatti' if field == 'gf' else 'subiti'}; "
                             + ", ".join(f"{t.club(c)} {abs(v)}" for c, v in r4[1:4]) + ".", [t.cid(c0)], fame=70)
            if ok["goals"]:
                tot = {p: sum(v.values()) for p, v in self.goals[(comp, season)].items()}
                r4 = self.top(tot)
                if r4 and all(t.is_notable(p) for p, _ in r4):
                    p0 = r4[0][0]
                    self.add(out, "stg_capocannoniere", (comp, season), comp, season, f"Chi è stato il capocannoniere {lab}?",
                             t.pname(p0), [t.pname(p) for p, _ in r4[1:4]],
                             f"Capocannoniere {lab}: {t.pname(p0)} con {r4[0][1]} gol; poi " + ", ".join(f"{t.pname(p)} {v}" for p, v in r4[1:4]) + ".",
                             [t.pid(p0)], fame=t.fame(p0))
            if ok["apx"]:
                ast = {p: sum(v[2] for v in by.values()) for p, by in self.apx[(comp, season)].items()}
                r4 = self.top(ast)
                if r4 and all(t.is_notable(p) for p, _ in r4):
                    p0 = r4[0][0]
                    self.add(out, "stg_assist", (comp, season), comp, season, f"Chi ha fornito più assist {lab}?", t.pname(p0),
                             [t.pname(p) for p, _ in r4[1:4]],
                             f"Più assist {lab}: {t.pname(p0)} con {r4[0][1]}; poi " + ", ".join(f"{t.pname(p)} {v}" for p, v in r4[1:4])
                             + ". Assist secondo Transfermarkt.", [t.pid(p0)], fame=t.fame(p0))
            if ok["lu"]:
                self.clean_sheets(out, comp, season, lab)
            # one club, one season
            notable_clubs = [c for c in clubs if c in t.sa_clubs or c in t.top_clubs.get(comp, [])[:10] or c in t.big]
            for club in notable_clubs:
                self.club_questions(out, comp, season, club, tab, ok)
        return out

    def clean_sheets(self, out, comp, season, lab) -> None:
        """Games started and played to the end by a goalkeeper whose team conceded nothing."""
        t = self.t
        rows = t.q("""select l.pid, gm.gid, l.club, gm.home, gm.hg, gm.ag, a.mins from lu l join gm using(gid)
            join apx a on a.gid = l.gid and a.pid = l.pid
            where gm.comp = ? and gm.season = ? and l.starter and l.pos = 'Goalkeeper'""", comp, season)
        cs: Counter = Counter()
        for pid, _gid, club, home, hg, ag, mins in rows:
            conceded = ag if club == home else hg
            if conceded == 0 and (mins or 0) >= 90:
                cs[int(pid)] += 1
        r4 = self.top(dict(cs))
        if r4 and all(t.is_notable(p) for p, _ in r4):
            p0 = r4[0][0]
            self.add(out, "stg_portiere", (comp, season), comp, season, f"Quale portiere ha tenuto più volte la porta inviolata {lab}?",
                     t.pname(p0), [t.pname(p) for p, _ in r4[1:4]],
                     f"Porta inviolata = partita giocata per intero da titolare senza subire gol. {cap(lab)}: {t.pname(p0)} {r4[0][1]}; "
                     + ", ".join(f"{t.pname(p)} {v}" for p, v in r4[1:4]) + ".", [t.pid(p0)], fame=t.fame(p0))

    def club_questions(self, out, comp, season, club, tab, ok) -> None:
        t = self.t
        lab = f"{IN_COMP[comp]} {season_label(season)}"
        who = t.club(club)
        if ok["goals"]:
            goals = {p: by[club] for p, by in self.goals[(comp, season)].items() if by.get(club)}
            r4 = self.top(goals)
            if r4 and all(t.is_notable(p) for p, _ in r4):
                p0 = r4[0][0]
                self.add(out, "stg_club_marcatore", (comp, season, club), comp, season, f"Chi è stato il miglior marcatore {t.di(club)} {lab}?",
                         t.pname(p0), [t.pname(p) for p, _ in r4[1:4]],
                         f"{who} {lab}: {t.pname(p0)} {r4[0][1]} gol; " + ", ".join(f"{t.pname(p)} {v}" for p, v in r4[1:4]) + ".",
                         [t.cid(club), t.pid(p0)], fame=t.fame(p0))
        if ok["apx"]:
            rows = {p: by[club] for p, by in self.apx[(comp, season)].items() if club in by}
            for gen, i, what in (("stg_club_presenze", 0, "ha giocato più partite"), ("stg_club_assist", 2, "ha fornito più assist")):
                r4 = self.top({p: v[i] for p, v in rows.items()})
                if r4 and all(t.is_notable(p) for p, _ in r4) and r4[0][1] > 0:
                    p0 = r4[0][0]
                    unit = "presenze" if i == 0 else "assist"
                    self.add(out, gen, (comp, season, club), comp, season, f"Chi {what} {t.con(club)} {lab}?", t.pname(p0),
                             [t.pname(p) for p, _ in r4[1:4]],
                             f"{who} {lab}: {t.pname(p0)} {r4[0][1]} {unit}; " + ", ".join(f"{t.pname(p)} {v}" for p, v in r4[1:4])
                             + ". Solo campionato, dati Transfermarkt.", [t.cid(club), t.pid(p0)], fame=t.fame(p0))
        # final place: recorded on the last matchday and confirmed by the points (no tie on points around it)
        row = tab[club]
        place, n = row["place"], len(tab)
        pts = sorted((r["pts"] for r in tab.values()), reverse=True)
        if place and pts.count(row["pts"]) == 1 and pts.index(row["pts"]) + 1 == place:
            r = random.Random(f"pos-{comp}-{season}-{club}")
            near = [p for p in range(max(1, place - 4), min(n, place + 4) + 1) if p != place]
            wrong = [f"{p}°" for p in sorted(r.sample(near, min(3, len(near))))]
            self.add(out, "stg_club_posizione", (comp, season, club), comp, season, f"In che posizione ha chiuso {t.il(club)} la {COMP_IT[comp]} {season_label(season)}?",
                     f"{place}°", wrong, f"{who} ha chiuso la {COMP_IT[comp]} {season_label(season)} al {place}° posto con {row['pts']} punti "
                     f"({row['gf']} gol fatti, {row['ga']} subiti).", [t.cid(club)], fame=75)


def generate(t: TM) -> dict[str, list[dict]]:
    s = Seasons(t)
    return {"tiro_secco": s.scheda() + s.stagione() + s.confronto()}

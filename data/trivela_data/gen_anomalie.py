"""L'Anomalia Statistica: multiple-choice questions on genuinely rare, counter-intuitive records (SPEC §4.2).

Every question has one option for which the record is true and three options for which it is false on the same data.
Only events that happen a handful of times per season in the whole of Europe's top flights qualify: a goalkeeper
scoring, an own goal and a goal in the same game, a substitute sent off minutes after coming on, a starter sent off
inside the first minutes, three red cards for one team, a defender's hat-trick, a player who wore both shirts in the
home-and-away games of the same tie. Common events (any substitute scoring, a defender with six goals in a season, a
forward without a goal, 100 games without a red card) were removed because they are not anomalies.

Claims about "never" only rest on seasons where every game has the data they need (goals, line-ups, cards), and the
distractors are checked on the same facts. Missed penalties are not in the dataset (only shoot-out kicks are), so no
question about them is made.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from .gen_quiz import END, Quiz
from .tm_core import IN_COMP, L5, SRC_DATASET, base, date_it, opts4, season_label

COMPS = (*L5, "CL")
SING = {"Defender": "difensore", "Midfield": "centrocampista", "Attack": "attaccante", "Goalkeeper": "portiere"}
WORD = {1: "un gol", 2: "due gol", 3: "tre gol", 4: "quattro gol"}
# how many differently-worded-by-options variants one rare event may yield (distinct distractor triples); rarer events get more
MAX_VARIANTS = 6


def longest_run(ok: dict[int, bool], min_seasons: int) -> tuple[int, int] | None:
    best, run = None, []
    for s in sorted(ok):
        if ok[s]:
            run.append(s)
            if best is None or len(run) > len(best):
                best = list(run)
        else:
            run = []
    return (best[0], best[-1]) if best and len(best) >= min_seasons else None


def triples(ds: list, v: int) -> list[list]:
    """Up to v distinct triples of distractors: disjoint ones when the pool allows, otherwise sliding windows."""
    if len(ds) < 3:
        return []
    stride = 3 if len(ds) >= 3 * v else 1
    return [ds[k * stride:k * stride + 3] for k in range(v) if k * stride + 3 <= len(ds)]


class Anomalie(Quiz):
    def __init__(self, t):
        super().__init__(t)
        q = t.q
        cmp = ",".join(f"'{c}'" for c in COMPS)
        self.cmp = cmp
        self.line = {pid: p["line"] for pid, p in t.players.items()}
        self.subin = {(int(g), int(p)) for g, p in q("select gid, pin from sub")}
        # appearances per (pid, comp, season)
        self.apps = defaultdict(int)
        for pid, comp, season, n in q(f"select p.pid, gm.comp, gm.season, count(*) from pres p join gm using(gid) where gm.comp in ({cmp}) group by 1, 2, 3"):
            self.apps[(int(pid), comp, int(season))] += int(n)
        self.seasons_of = defaultdict(set)  # (pid, comp) -> seasons he played
        for (pid, comp, season) in self.apps:
            self.seasons_of[(pid, comp)].add(season)
        # a game's cards are trusted only where the two records agree: card events and the appearance rows give the same totals
        self.cards_ok = {int(r[0]) for r in q("""select gm.gid from gm
            join (select gid, sum(yc) y, sum(rc) r from apx group by 1) a using(gid)
            join (select gid, count(*) filter (where descr ilike '%yellow card%' or descr ilike 'Second yellow%') y,
                         count(*) filter (where descr ilike 'Red card%') r from ev where type = 'Cards' group by 1) e using(gid)
            where a.y = e.y and a.r = e.r""")}
        self.apps_ok = defaultdict(int)  # appearances in games with trusted cards
        ok_ids = ",".join(str(g) for g in self.cards_ok) or "0"
        for pid, comp, season, n in q(f"select p.pid, gm.comp, gm.season, count(*) from pres p join gm using(gid) where gm.comp in ({cmp}) and p.gid in ({ok_ids}) group by 1, 2, 3"):
            self.apps_ok[(int(pid), comp, int(season))] = int(n)
        self.assists = defaultdict(int)
        for pid, comp, season, n in q(f"select a.pid, gm.comp, gm.season, sum(a.assists) from apx a join gm using(gid) where gm.comp in ({cmp}) group by 1, 2, 3"):
            self.assists[(int(pid), comp, int(season))] = int(n or 0)
        self.red_ev = defaultdict(int)  # (pid, comp) -> red cards in the events
        for pid, comp, n in q(f"select r.pid, gm.comp, count(*) from red r join gm using(gid) where gm.comp in ({cmp}) group by 1, 2"):
            self.red_ev[(int(pid), comp)] = int(n)
        # seasons in which every game carries the data a claim needs
        apx_games = {int(r[0]) for r in q("select gid from apchk where n >= 22")}
        games_by = defaultdict(list)
        for g in self.G.values():
            games_by[(g["comp"], g["season"])].append(g["gid"])
        self.ok = {}
        for comp in COMPS:
            pres = t.valid_seasons(comp, None, "pres")
            goal = t.valid_seasons(comp, None, "goal")
            apxv = {s: all(gid in apx_games for gid in games_by[(comp, s)]) for s in pres}
            self.ok[comp] = {"pres": pres, "goal": goal, "apx": {s: pres[s] and apxv[s] for s in pres}}

    # ------------------------------------------------------------------ helpers
    def add_an(self, gen: str, key, question: str, correct: str, distractors: list[str], *, year: int, fame: int, script: str,
               entities: list[str], comp: str, sources: list[dict], kind: str) -> bool:
        o = opts4(correct, distractors, f"{gen}-{key}")
        if not o:
            return False
        g = gen if comp in ("IT1", "CL") else f"{gen}@estero"
        it = base(g, key, year=year, fame=fame, entities=[f"comp:{comp}", *entities], sources=sources, script=script)
        it.update({"question": question, "options": o[0], "correct": o[1], "kind": kind})
        self.out.append(it)
        return True

    def emit(self, gen: str, key, question: str, correct: str, ds: list[str], v: int, **kw) -> int:
        """One question per distinct triple of distractors (the same rare fact, different company)."""
        n = 0
        for k, trio in enumerate(triples(ds, v)):
            n += self.add_an(gen, (*key, k), question, correct, trio, **kw)
        return n

    def pool(self, pid: int, comp: str, season: int, line: str | None, k: int = 80) -> list[int]:
        """Famous players of the same age group who played in the comp around that season (same role when given)."""
        t = self.t
        yob = (t.players[pid]["dob"] or dt.date(1990, 1, 1)).year
        cand = set()
        for s in (season - 1, season, season + 1):
            cand |= self.season_players.get((comp, s), set())
        cand.discard(pid)
        ok = [p for p in cand if t.players[p]["dob"] and abs(t.players[p]["dob"].year - yob) <= 6 and (line is None or self.line.get(p) == line)]
        return sorted(ok, key=lambda p: (-t.fame(p), p))[:k]

    def trusted_cards(self, pid: int, comp: str) -> bool:
        """Every game he played in the comp has cards on which both records agree."""
        return all(self.apps_ok.get((pid, comp, s), 0) == self.apps.get((pid, comp, s), 0) for s in self.seasons_of.get((pid, comp), ()))

    def trusted_pres(self, pid: int, comp: str) -> bool:
        """Every season he played in the comp has complete line-ups for all its games."""
        return all(self.ok[comp]["pres"].get(s, False) for s in self.seasons_of.get((pid, comp), ()))

    def window(self, comp: str, kind: str, min_seasons: int = 5):
        return longest_run(self.ok[comp][kind], min_seasons)

    def distractors(self, pid: int, comp: str, season: int, owners: set[int], check, line: str | None = None, n: int = 14) -> list[str]:
        t = self.t
        ds = []
        for q in self.pool(pid, comp, season, line):
            if q not in owners and check(q, comp):
                ds.append(t.pname(q))
            if len(ds) >= n:
                break
        return ds

    # ------------------------------------------------------------------ goals in a single game
    def multi_goals(self, gen: str, line: str | None, min_goals: int, as_sub: bool, subject: str, what: str, kind: str, v: int) -> None:
        t = self.t
        best: dict[tuple[int, str], tuple] = {}
        for pid, lst in self.pgoals.items():
            if not t.is_notable(pid) or (line is not None and self.line.get(pid) != line):
                continue
            for d, comp, season, gid, club, n in sorted(lst):
                if comp in COMPS and n >= min_goals and (not as_sub or (gid, pid) in self.subin) and (pid, comp) not in best:
                    best[(pid, comp)] = (d, season, gid, n)
        owners = defaultdict(set)  # comp -> players for whom the record is true
        for (pid, comp) in best:
            owners[comp].add(pid)
        clean = lambda q, comp: self.clean_history(q, comp, END)  # noqa: E731
        for (pid, comp), (d, season, gid, n) in sorted(best.items(), key=lambda kv: (-t.fame(kv[0][0]), kv[0])):
            ds = self.distractors(pid, comp, season, owners[comp], clean, line)
            g = self.G[gid]
            who = f"Quale di questi {subject} {what} {IN_COMP[comp]} (stagioni 2012/13–2025/26)?"
            self.emit(gen, (pid, comp), who, t.pname(pid), ds, v, year=d.year, fame=t.fame(pid), entities=[t.pid(pid)], comp=comp,
                      sources=[t.src_game(g), t.src_player(pid)], kind=kind,
                      script=f"{t.pname(pid)} ({SING.get(self.line.get(pid), 'giocatore')}) ha segnato {WORD.get(n, f'{n} gol')} in {t.label(g)} ({t.ctx(g)}, {d.day}/{d.month}/{d.year}).")

    # ------------------------------------------------------------------ an own goal and a goal in the same game
    def own_and_goal(self, v: int) -> None:
        t = self.t
        rows = t.q(f"""select g.gid, g.pid, g.minute, o.minute from goal g
            join goal o on o.gid = g.gid and o.pid = g.pid and o.own and not g.own and o.club <> g.club
            join pres p on p.gid = g.gid and p.pid = g.pid and p.club = g.club
            join gm on gm.gid = g.gid where gm.comp in ({self.cmp}) group by 1, 2, 3, 4""")
        events = {}
        for gid, pid, gmin, omin in rows:
            pid = int(pid)
            if t.is_notable(pid):
                events.setdefault((pid, self.G[int(gid)]["comp"]), (int(gid), int(gmin), int(omin)))
        owners = defaultdict(set)
        for (pid, comp) in events:
            owners[comp].add(pid)
        clean = lambda q, comp: self.clean_history(q, comp, END)  # noqa: E731
        for (pid, comp), (gid, gmin, omin) in sorted(events.items(), key=lambda kv: (-t.fame(kv[0][0]), kv[0])):
            g = self.G[gid]
            ds = self.distractors(pid, comp, g["season"], owners[comp], clean)
            q = f"Quale di questi giocatori ha segnato un autogol e un gol per la propria squadra nella stessa partita {IN_COMP[comp]} (stagioni 2012/13–2025/26)?"
            self.emit("an_autogol_e_gol", (pid, comp), q, t.pname(pid), ds, v, year=g["date"].year, fame=t.fame(pid), entities=[t.pid(pid)], comp=comp,
                      sources=[t.src_game(g), t.src_player(pid)], kind="autogol",
                      script=f"{t.pname(pid)} in {t.label(g)} ({t.ctx(g)}, {date_it(g['date'])}): "
                             + (f"gol per la propria squadra al {gmin}' e autogol al {omin}'." if gmin <= omin else f"autogol al {omin}' e gol per la propria squadra al {gmin}'."))

    # ------------------------------------------------------------------ cards
    def sub_sent_off(self, lo: int, limit: int, v: int) -> None:
        """A substitute sent off less than `limit` minutes after coming on (the protagonist waited at least `lo` minutes, so the 5 and
        10 minute questions never repeat the same event). Everyone who did it within `limit` minutes is excluded from the distractors."""
        t = self.t
        rows = t.q(f"""select s.gid, s.pin, s.minute, d.minute from sub s
            join red d on d.gid = s.gid and d.pid = s.pin and d.minute >= s.minute and d.minute - s.minute < {limit}
            join gm on gm.gid = s.gid where gm.comp in ({self.cmp})""")
        events, everyone = {}, defaultdict(set)
        for gid, pid, sm, rm in rows:
            pid, gid = int(pid), int(gid)
            everyone[self.G[gid]["comp"]].add(pid)
            if gid in self.cards_ok and t.is_notable(pid) and rm - sm >= lo:
                events.setdefault((pid, self.G[gid]["comp"]), (gid, int(sm), int(rm)))
        check = lambda q, comp: self.trusted_cards(q, comp)  # noqa: E731
        for (pid, comp), (gid, sm, rm) in sorted(events.items(), key=lambda kv: (-t.fame(kv[0][0]), kv[0])):
            g = self.G[gid]
            ds = self.distractors(pid, comp, g["season"], everyone[comp], check)
            q = f"Quale di questi giocatori è stato espulso meno di {limit} minuti dopo essere entrato dalla panchina {IN_COMP[comp]} (stagioni 2012/13–2025/26)?"
            self.emit(f"an_subentrato_espulso_{limit}", (pid, comp), q, t.pname(pid), ds, v, year=g["date"].year, fame=t.fame(pid), entities=[t.pid(pid)], comp=comp,
                      sources=[t.src_game(g), t.src_player(pid)], kind="disciplina",
                      script=f"{t.pname(pid)} in {t.label(g)} ({t.ctx(g)}, {date_it(g['date'])}): entrato al {sm}', espulso al {rm}' ({rm - sm} minuti dopo).")

    def early_red(self, lo: int, limit: int, v: int) -> None:
        """A starter sent off within the first `limit` minutes (after minute `lo`, so the 5 and 10 minute questions never repeat an event)."""
        t = self.t
        rows = t.q(f"""select d.gid, d.pid, d.minute from red d join pres p on p.gid = d.gid and p.pid = d.pid and p.starter
            join gm on gm.gid = d.gid where gm.comp in ({self.cmp}) and d.minute <= {limit}""")
        events, everyone = {}, defaultdict(set)
        for gid, pid, m in rows:
            pid, gid = int(pid), int(gid)
            everyone[self.G[gid]["comp"]].add(pid)
            if gid in self.cards_ok and t.is_notable(pid) and m > lo:
                events.setdefault((pid, self.G[gid]["comp"]), (gid, int(m)))
        check = lambda q, comp: self.trusted_cards(q, comp)  # noqa: E731
        for (pid, comp), (gid, m) in sorted(events.items(), key=lambda kv: (-t.fame(kv[0][0]), kv[0])):
            g = self.G[gid]
            ds = self.distractors(pid, comp, g["season"], everyone[comp], check)
            q = f"Quale di questi giocatori è stato espulso nei primi {limit} minuti di una partita {IN_COMP[comp]}, da titolare (stagioni 2012/13–2025/26)?"
            self.emit(f"an_espulso_presto_{limit}", (pid, comp), q, t.pname(pid), ds, v, year=g["date"].year, fame=t.fame(pid), entities=[t.pid(pid)], comp=comp,
                      sources=[t.src_game(g), t.src_player(pid)], kind="disciplina",
                      script=f"{t.pname(pid)} in {t.label(g)} ({t.ctx(g)}, {date_it(g['date'])}): espulso al {m}' di gioco, scendendo in campo dall'inizio.")

    def three_reds(self, v: int) -> None:
        """Games in which one team finished with three or more players sent off."""
        t = self.t
        per_team = defaultdict(int)
        for gid, club, n in t.q(f"select r.gid, r.club, count(*) from red r join gm on gm.gid = r.gid where gm.comp in ({self.cmp}) group by 1, 2"):
            per_team[(int(gid), int(club))] = int(n)
        worst = defaultdict(int)  # gid -> most reds for one team
        for (gid, club), n in per_team.items():
            worst[gid] = max(worst[gid], n)
        by_comp = defaultdict(list)  # comp -> games with exactly two reds for one team: the closest false options
        for gid, n in worst.items():
            if n == 2 and gid in self.cards_ok:
                by_comp[self.G[gid]["comp"]].append(gid)
        for comp in by_comp:
            by_comp[comp].sort()
        label = lambda g: f"{t.label(g)} · {season_label(g['season']) if g['comp'] in L5 or g['comp'] == 'CL' else g['date'].year}"  # noqa: E731
        for gid in sorted(g for g, n in worst.items() if n >= 3 and g in self.cards_ok):
            g = self.G[gid]
            comp = g["comp"]
            pool = [x for x in by_comp.get(comp, []) if x != gid]
            if len(pool) < 3:
                continue
            # spread the distractors over the years rather than taking the first ones
            step = max(1, len(pool) // 24)
            ds = [label(self.G[x]) for x in pool[gid % step::step]][:24]
            hit = [c for (gg, c), n in per_team.items() if gg == gid and n >= 3][0]
            q = f"In quale di queste partite {IN_COMP[comp]} una stessa squadra ha finito con almeno tre giocatori espulsi?"
            reds = per_team[(gid, hit)]
            self.emit("an_tre_espulsi", (gid,), q, label(g), ds, v, year=g["date"].year, fame=70, entities=[t.cid(g["home"]), t.cid(g["away"])], comp=comp,
                      sources=[t.src_game(g)], kind="partita",
                      script=f"{t.label(g)} ({t.ctx(g)}, {date_it(g['date'])}): {t.il(hit)} ha chiuso la partita con {reds} giocatori espulsi.")

    # ------------------------------------------------------------------ the same man with both shirts of a double fixture
    def both_legs(self, v: int) -> None:
        t = self.t
        by = defaultdict(list)
        for pid, gid, club, comp, season, h, a in t.q(f"""select p.pid, p.gid, p.club, gm.comp, gm.season, gm.home, gm.away from pres p join gm using(gid)
                                                           where gm.comp in ({self.cmp})"""):
            by[(int(pid), comp, int(season))].append((int(gid), int(club), int(h), int(a)))
        events = {}
        owners = defaultdict(set)
        for (pid, comp, season), lst in by.items():
            if len(lst) < 2 or not self.ok[comp]["pres"].get(season):
                continue
            for i in range(len(lst)):
                for j in range(i + 1, len(lst)):
                    g1, c1, h1, a1 = lst[i]
                    g2, c2, h2, a2 = lst[j]
                    if g1 != g2 and c1 != c2 and {h1, a1} == {h2, a2} and {c1, c2} == {h1, a1}:
                        owners[comp].add(pid)
                        if t.is_notable(pid):
                            first, second = sorted(((self.G[g1]["date"], g1, c1), (self.G[g2]["date"], g2, c2)))
                            events.setdefault((pid, comp, season), (first, second))
        check = lambda q, comp: self.trusted_pres(q, comp)  # noqa: E731
        for (pid, comp, season), ((d1, g1, c1), (d2, g2, c2)) in sorted(events.items(), key=lambda kv: (-t.fame(kv[0][0]), kv[0])):
            ds = self.distractors(pid, comp, season, owners[comp], check)
            ga, gb = self.G[g1], self.G[g2]
            q = (f"Quale di questi giocatori ha giocato per una squadra all'andata e per l'avversaria al ritorno, nelle due partite della stessa stagione "
                 f"tra le stesse due squadre {IN_COMP[comp]} (stagioni 2012/13–2025/26)?")
            self.emit("an_andata_ritorno", (pid, comp, season), q, t.pname(pid), ds, v, year=season, fame=t.fame(pid), entities=[t.pid(pid)], comp=comp,
                      sources=[t.src_game(ga), t.src_game(gb), t.src_player(pid)], kind="mercato",
                      script=f"{t.pname(pid)} ha giocato {t.con(c1)} in {t.teams(ga)} ({date_it(d1)}) e {t.con(c2)} nel ritorno {t.teams(gb)} ({date_it(d2)}): "
                             f"la stessa sfida con maglie opposte.")

    # ------------------------------------------------------------------ goalkeepers who assisted
    def gk_assist(self, v: int) -> None:
        t = self.t
        for comp in L5:
            w = self.window(comp, "apx")
            if not w:
                continue
            seasons = range(w[0], w[1] + 1)
            ast, apps = defaultdict(int), defaultdict(int)
            for (pid, c, s), n in self.apps.items():
                if c == comp and s in seasons and self.line.get(pid) == "Goalkeeper" and t.is_notable(pid):
                    apps[pid] += n
                    ast[pid] += self.assists.get((pid, c, s), 0)
            good = sorted((p for p in apps if ast[p] >= 1), key=lambda p: (-t.fame(p), p))
            bad = sorted((p for p in apps if apps[p] >= 30 and ast[p] == 0), key=lambda p: (-t.fame(p), p))
            if len(bad) < 3:
                continue
            for pid in good:
                near = sorted(bad, key=lambda p: (abs(t.players[p]["dob"].year - t.players[pid]["dob"].year) if t.players[p]["dob"] and t.players[pid]["dob"] else 9, -t.fame(p)))[:14]
                q = f"Quale di questi portieri ha fornito almeno un assist {IN_COMP[comp]} tra il {season_label(w[0])} e il {season_label(w[1])}?"
                self.emit("an_portiere_assist", (pid, comp, w), q, t.pname(pid), [t.pname(p) for p in near], v, year=w[1], fame=t.fame(pid),
                          entities=[t.pid(pid)], comp=comp, sources=[SRC_DATASET, t.src_player(pid)], kind="portiere",
                          script=f"{t.pname(pid)} ha fornito {ast[pid]} assist {IN_COMP[comp]} dal {season_label(w[0])} al {season_label(w[1])}, da portiere. "
                                 f"Gli altri portieri, con almeno 30 presenze, non ne hanno registrato nessuno.")

    def run(self) -> list[dict]:
        v = MAX_VARIANTS
        self.multi_goals("an_portiere_gol", "Goalkeeper", 1, False, "portieri", "ha segnato un gol", "portiere", v)
        self.multi_goals("an_difensore_tripletta", "Defender", 3, False, "difensori", "ha segnato almeno tre gol in una partita (una tripletta)", "difensore", v)
        self.multi_goals("an_difensore_doppietta", "Defender", 2, False, "difensori", "ha segnato almeno due gol in una singola partita", "difensore", 2)
        self.multi_goals("an_panchina_tripletta", None, 3, True, "giocatori", "è entrato dalla panchina e ha segnato almeno tre gol nella stessa partita", "panchina", v)
        self.multi_goals("an_poker", "Attack", 4, False, "attaccanti", "ha segnato almeno quattro gol in una partita", "attaccante", 3)
        self.own_and_goal(3)
        self.sub_sent_off(0, 5, v)
        self.sub_sent_off(5, 10, 3)
        self.early_red(-1, 5, v)
        self.early_red(5, 10, 3)
        self.three_reds(v + 2)
        self.both_legs(3)
        self.gk_assist(v)
        return self.out


def generate(t) -> dict[str, list[dict]]:
    return {"anomalia": Anomalie(t).run()}

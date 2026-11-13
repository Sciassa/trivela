"""L'Anomalia Statistica: multiple-choice questions on bizarre, counter-intuitive records (SPEC §4.1b).

Every question has one option for which the record is true and three famous players for whom it is false on the same data.
Claims about "never" are only made inside windows of seasons where every game has the data they need (goals, line-ups,
cards or assists), and the window is written in the question.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from .gen_quiz import END, Quiz
from .tm_core import IN_COMP, L5, SRC_DATASET, base, opts4, season_label

COMPS = (*L5, "CL")
LINE_IT = {"Defender": "difensori", "Midfield": "centrocampisti", "Attack": "attaccanti", "Goalkeeper": "portieri"}
SING = {"Defender": "difensore", "Midfield": "centrocampista", "Attack": "attaccante", "Goalkeeper": "portiere"}
WORD = {1: "un gol", 2: "due gol", 3: "tre gol", 4: "quattro gol"}


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


class Anomalie(Quiz):
    def __init__(self, t):
        super().__init__(t)
        q = t.q
        cmp = ",".join(f"'{c}'" for c in COMPS)
        self.line = {pid: p["line"] for pid, p in t.players.items()}
        self.subin = {(int(g), int(p)) for g, p in q("select gid, pin from sub")}
        # per (pid, comp, season) aggregates
        self.apps = defaultdict(int)
        for pid, comp, season, n in q(f"select p.pid, gm.comp, gm.season, count(*) from pres p join gm using(gid) where gm.comp in ({cmp}) group by 1, 2, 3"):
            self.apps[(int(pid), comp, int(season))] += int(n)
        # cards and assists come from the appearances table: one row per player per game, complete where a game has its 22+ rows
        self.yellow, self.red = defaultdict(int), defaultdict(int)
        for pid, comp, season, y, r in q(f"select a.pid, gm.comp, gm.season, sum(a.yc), sum(a.rc) from apx a join gm using(gid) where gm.comp in ({cmp}) group by 1, 2, 3"):
            self.yellow[(int(pid), comp, int(season))] = int(y or 0)
            self.red[(int(pid), comp, int(season))] = int(r or 0)
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
        self.ev_yellow, self.ev_red = defaultdict(int), defaultdict(int)  # the same cards, counted from the events
        for pid, comp, season, y, r in q(f"""select e.pid, gm.comp, gm.season, count(*) filter (where e.descr ilike '%yellow card%'),
                count(*) filter (where e.descr ilike 'Red card%' or e.descr ilike 'Second yellow%') from ev e join gm using(gid)
                where e.type = 'Cards' and e.pid is not null and gm.comp in ({cmp}) group by 1, 2, 3"""):
            self.ev_yellow[(int(pid), comp, int(season))] = int(y)
            self.ev_red[(int(pid), comp, int(season))] = int(r)
        self.assists = defaultdict(int)
        for pid, comp, season, n in q(f"select a.pid, gm.comp, gm.season, sum(a.assists) from apx a join gm using(gid) where gm.comp in ({cmp}) group by 1, 2, 3"):
            self.assists[(int(pid), comp, int(season))] = int(n or 0)
        self.season_goals = defaultdict(int)
        for pid, comp, season, n in q(f"select pg.pid, gm.comp, gm.season, sum(pg.goals) from pg join gm using(gid) where gm.comp in ({cmp}) group by 1, 2, 3"):
            self.season_goals[(int(pid), comp, int(season))] = int(n)
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

    def pool(self, pid: int, comp: str, season: int, line: str | None, k: int = 60) -> list[int]:
        """Famous players of the same age group who played in the comp around that season (same role when given)."""
        t = self.t
        yob = (t.players[pid]["dob"] or dt.date(1990, 1, 1)).year
        cand = set()
        for s in (season - 1, season, season + 1):
            cand |= self.season_players.get((comp, s), set())
        cand.discard(pid)
        ok = [p for p in cand if t.players[p]["dob"] and abs(t.players[p]["dob"].year - yob) <= 6 and (line is None or self.line.get(p) == line)]
        return sorted(ok, key=lambda p: (-t.fame(p), p))[:k]

    def trusted(self, pid: int, comp: str, season: int) -> bool:
        """Every game he played that season has cards on which both records agree."""
        return self.apps_ok.get((pid, comp, season), 0) == self.apps.get((pid, comp, season), 0)

    def window(self, comp: str, kind: str, min_seasons: int = 5):
        return longest_run(self.ok[comp][kind], min_seasons)

    # ------------------------------------------------------------------ goals in a single game
    def multi_goals(self, gen: str, line: str | None, min_goals: int, as_sub: bool, subject: str, what: str, kind: str) -> None:
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
        for (pid, comp), (d, season, gid, n) in sorted(best.items(), key=lambda kv: (-t.fame(kv[0][0]), kv[0])):
            ds = []
            for q in self.pool(pid, comp, season, line):
                if q not in owners[comp] and self.clean_history(q, comp, END):
                    ds.append(t.pname(q))
                if len(ds) >= 8:
                    break
            g = self.G[gid]
            who = f"Quale di questi {subject} {what} {IN_COMP[comp]} (stagioni 2012/13–2025/26)?"
            self.add_an(gen, (pid, comp), who, t.pname(pid), ds, year=d.year, fame=t.fame(pid), entities=[t.pid(pid)], comp=comp,
                        sources=[t.src_game(g), t.src_player(pid)], kind=kind,
                        script=f"{t.pname(pid)} ({SING.get(self.line.get(pid), 'giocatore')}) ha segnato {WORD.get(n, f'{n} gol')} in {t.label(g)} ({t.ctx(g)}, {d.day}/{d.month}/{d.year}).")

    # ------------------------------------------------------------------ never sent off
    def window_stats(self, pid: int, comp: str, a: int, b: int) -> tuple[int, int, int]:
        """Appearances, reds in the appearance rows, reds in the events, over seasons a..b."""
        apps = reds = ev = 0
        for ss in range(a, b + 1):
            apps += self.apps.get((pid, comp, ss), 0)
            reds += self.red.get((pid, comp, ss), 0)
            ev += self.ev_red.get((pid, comp, ss), 0)
        return apps, reds, ev

    def never_red(self) -> None:
        """Forwards and midfielders with 100+ games and no red card, over the longest run of seasons in which every game of theirs has trusted cards."""
        t = self.t
        for comp in L5:
            w = self.window(comp, "apx")
            if not w:
                continue
            for line in ("Attack", "Midfield"):
                players = sorted({p for (p, c, s) in self.apps if c == comp and w[0] <= s <= w[1] and self.line.get(p) == line and t.is_notable(p)})
                for pid in players:
                    # best run of consecutive seasons, all trusted, with 100+ games
                    best = None
                    for a in range(w[0], w[1] + 1):
                        for b in range(a, w[1] + 1):
                            if not all(self.trusted(pid, comp, ss) for ss in range(a, b + 1)):
                                break
                            apps, reds, ev = self.window_stats(pid, comp, a, b)
                            if apps >= 100 and reds == 0 and ev == 0 and (best is None or (b - a, apps) > (best[1] - best[0], best[2])):
                                best = (a, b, apps)
                                break  # the shortest run that reaches 100 games is the cleanest claim
                    if not best:
                        continue
                    a, b, apps = best
                    bad = []
                    for q in sorted((p for p in players if p != pid), key=lambda p: (abs((t.players[p]["dob"] or dt.date(1990, 1, 1)).year - (t.players[pid]["dob"] or dt.date(1990, 1, 1)).year), -t.fame(p))):
                        n, r, e = self.window_stats(q, comp, a, b)
                        if n >= 100 and r >= 1 and e >= 1:
                            bad.append(q)
                        if len(bad) >= 8:
                            break
                    q_text = (f"Quale di questi {LINE_IT[line]}, con almeno 100 presenze {IN_COMP[comp]} tra il {season_label(a)} e il {season_label(b)}, "
                              f"non è mai stato espulso?")
                    self.add_an("an_mai_espulso", (pid, comp, a, b), q_text, t.pname(pid), [t.pname(p) for p in bad], year=b, fame=t.fame(pid),
                                entities=[t.pid(pid)], comp=comp, sources=[SRC_DATASET, t.src_player(pid)], kind="disciplina",
                                script=f"{t.pname(pid)}: {apps} presenze {IN_COMP[comp]} dal {season_label(a)} al {season_label(b)} e nessuna espulsione. "
                                       f"Gli altri hanno almeno 100 presenze nello stesso periodo e almeno un'espulsione.")

    # ------------------------------------------------------------------ never booked in a season
    def never_booked(self) -> None:
        t = self.t
        for comp in L5:
            for s in [s for s, v in self.ok[comp]["apx"].items() if v]:
                for line in ("Defender", "Midfield"):
                    rows = [(pid, n) for (pid, c, ss), n in self.apps.items() if c == comp and ss == s and n >= 30 and self.line.get(pid) == line and t.is_notable(pid)]
                    good = [p for p, n in rows if self.yellow.get((p, comp, s), 0) == 0 and self.ev_yellow.get((p, comp, s), 0) == 0 and self.trusted(p, comp, s)]
                    bad = [p for p, n in rows if self.yellow.get((p, comp, s), 0) >= 6 and self.ev_yellow.get((p, comp, s), 0) >= 6]
                    if len(bad) < 3:
                        continue
                    for pid in sorted(good, key=lambda p: (-t.fame(p), p)):
                        near = sorted(bad, key=lambda p: (-t.fame(p), p))[:8]
                        q = (f"Quale di questi {LINE_IT[line]} ha giocato almeno 30 partite {IN_COMP[comp]} nel {season_label(s)} senza ricevere nemmeno un'ammonizione?")
                        self.add_an("an_mai_ammonito", (pid, comp, s), q, t.pname(pid), [t.pname(p) for p in near], year=s, fame=t.fame(pid),
                                    entities=[t.pid(pid)], comp=comp, sources=[SRC_DATASET, t.src_player(pid)], kind="disciplina",
                                    script=f"{t.pname(pid)}: {self.apps[(pid, comp, s)]} presenze {IN_COMP[comp]} nel {season_label(s)} e nessun cartellino giallo.")

    # ------------------------------------------------------------------ goalkeepers who assisted
    def gk_assist(self) -> None:
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
                near = sorted(bad, key=lambda p: (abs(t.players[p]["dob"].year - t.players[pid]["dob"].year) if t.players[p]["dob"] and t.players[pid]["dob"] else 9, -t.fame(p)))[:8]
                q = f"Quale di questi portieri ha fornito almeno un assist {IN_COMP[comp]} tra il {season_label(w[0])} e il {season_label(w[1])}?"
                self.add_an("an_portiere_assist", (pid, comp, w), q, t.pname(pid), [t.pname(p) for p in near], year=w[1], fame=t.fame(pid),
                            entities=[t.pid(pid)], comp=comp, sources=[SRC_DATASET, t.src_player(pid)], kind="portiere",
                            script=f"{t.pname(pid)} ha fornito {ast[pid]} assist {IN_COMP[comp]} dal {season_label(w[0])} al {season_label(w[1])}, da portiere. "
                                   f"Gli altri tre portieri, con almeno 30 presenze, non ne hanno registrato nessuno.")

    # ------------------------------------------------------------------ defenders who scored a lot in a season
    def defender_season(self, min_goals: int = 6) -> None:
        t = self.t
        for comp in L5:
            for s, okg in self.ok[comp]["goal"].items():
                if not okg or not self.ok[comp]["pres"].get(s):
                    continue
                rows = [(pid, n) for (pid, c, ss), n in self.apps.items() if c == comp and ss == s and n >= 25 and self.line.get(pid) == "Defender" and t.is_notable(pid)]
                good = [p for p, n in rows if self.season_goals.get((p, comp, s), 0) >= min_goals]
                bad = [p for p, n in rows if self.season_goals.get((p, comp, s), 0) <= 1]
                if len(bad) < 3:
                    continue
                for pid in good:
                    near = sorted(bad, key=lambda p: (-t.fame(p), p))[:8]
                    goals = self.season_goals[(pid, comp, s)]
                    q = f"Quale di questi difensori ha segnato almeno {min_goals} gol {IN_COMP[comp]} nel {season_label(s)}?"
                    self.add_an("an_difensore_bomber", (pid, comp, s), q, t.pname(pid), [t.pname(p) for p in near], year=s, fame=t.fame(pid),
                                entities=[t.pid(pid)], comp=comp, sources=[SRC_DATASET, t.src_player(pid)], kind="difensore",
                                script=f"{t.pname(pid)}, difensore, ha chiuso il {season_label(s)} {IN_COMP[comp]} con {goals} gol. "
                                       f"Gli altri tre difensori, con almeno 25 presenze, ne hanno segnato al massimo uno.")

    # ------------------------------------------------------------------ forwards who never scored
    def scoreless_forward(self) -> None:
        t = self.t
        for comp in L5:
            for s, okg in self.ok[comp]["goal"].items():
                if not okg or not self.ok[comp]["pres"].get(s):
                    continue
                rows = [p for (p, c, ss), n in self.apps.items() if c == comp and ss == s and n >= 25 and self.line.get(p) == "Attack" and t.is_notable(p)]
                good = [p for p in rows if self.season_goals.get((p, comp, s), 0) == 0]
                bad = sorted((p for p in rows if self.season_goals.get((p, comp, s), 0) >= 10), key=lambda p: (-t.fame(p), p))
                if len(bad) < 3:
                    continue
                for pid in good:
                    q = f"Quale di questi attaccanti ha giocato almeno 25 partite {IN_COMP[comp]} nel {season_label(s)} senza segnare nemmeno un gol?"
                    self.add_an("an_attaccante_a_secco", (pid, comp, s), q, t.pname(pid), [t.pname(p) for p in bad[:8]], year=s, fame=t.fame(pid),
                                entities=[t.pid(pid)], comp=comp, sources=[SRC_DATASET, t.src_player(pid)], kind="attaccante",
                                script=f"{t.pname(pid)}, attaccante, ha giocato {self.apps[(pid, comp, s)]} partite {IN_COMP[comp]} nel {season_label(s)} senza segnare. "
                                       f"Gli altri tre attaccanti hanno giocato almeno 25 partite e segnato almeno 10 gol.")

    # ------------------------------------------------------------------ scored for two clubs in the same season
    def two_clubs(self) -> None:
        t = self.t
        clubs = defaultdict(set)
        for pid, lst in self.pgoals.items():
            for d, comp, season, gid, club, n in lst:
                if comp in L5 and n > 0:
                    clubs[(pid, comp, season)].add(club)
        owners = defaultdict(set)  # comp -> players who did it at least once
        for (pid, comp, season), cs in clubs.items():
            if len(cs) >= 2 and t.is_notable(pid) and self.ok[comp]["goal"].get(season):
                owners[comp].add(pid)
        for (pid, comp, season), cs in sorted(clubs.items(), key=lambda kv: (-t.fame(kv[0][0]), kv[0])):
            if len(cs) < 2 or pid not in owners[comp] or not self.ok[comp]["goal"].get(season) or not self.ok[comp]["pres"].get(season):
                continue
            ds = []
            for q in self.pool(pid, comp, season, self.line.get(pid)):
                if q not in owners[comp] and self.clean_history(q, comp, END):
                    ds.append(t.pname(q))
                if len(ds) >= 8:
                    break
            names = " e ".join(t.club(c) for c in sorted(cs))
            self.add_an("an_due_maglie", (pid, comp, season), f"Quale di questi giocatori ha segnato per due squadre diverse nella stessa stagione {IN_COMP[comp]} (stagioni 2012/13–2025/26)?",
                        t.pname(pid), ds, year=season, fame=t.fame(pid), entities=[t.pid(pid)], comp=comp, sources=[SRC_DATASET, t.src_player(pid)], kind="mercato",
                        script=f"{t.pname(pid)} ha segnato {IN_COMP[comp]} nel {season_label(season)} sia con una squadra sia con un'altra ({names}).")

    # ------------------------------------------------------------------ top scorers without a single penalty
    def no_penalties(self) -> None:
        t = self.t
        stats = defaultdict(lambda: [0, 0])
        for pid, comp, season, n, pen in t.q("""select e.pid, gm.comp, gm.season, count(*), count(*) filter (where e.pen) from goal e join gm using(gid)
                                                  where not e.own and gm.comp in ('IT1','GB1','ES1','L1','FR1') group by 1, 2, 3"""):
            stats[(int(pid), comp, int(season))] = [int(n), int(pen)]
        for comp in L5:
            ev_ok = t.valid_seasons(comp, None, "ev")
            for s, okev in ev_ok.items():
                if not okev:
                    continue
                rows = [(p, v) for (p, c, ss), v in stats.items() if c == comp and ss == s and v[0] >= 15 and t.is_notable(p)]
                good = [p for p, v in rows if v[1] == 0]
                bad = sorted((p for p, v in rows if v[1] >= 5), key=lambda p: (-t.fame(p), p))
                if len(bad) < 3:
                    continue
                for pid in good:
                    n = stats[(pid, comp, s)][0]
                    q = f"Quale di questi attaccanti ha segnato almeno 15 gol {IN_COMP[comp]} nel {season_label(s)} senza battere nemmeno un rigore?"
                    self.add_an("an_senza_rigori", (pid, comp, s), q, t.pname(pid), [t.pname(p) for p in bad[:8]], year=s, fame=t.fame(pid),
                                entities=[t.pid(pid)], comp=comp, sources=[SRC_DATASET, t.src_player(pid)], kind="attaccante",
                                script=f"{t.pname(pid)} ha segnato {n} gol {IN_COMP[comp]} nel {season_label(s)}, nessuno su rigore. "
                                       f"Gli altri tre attaccanti ne hanno segnati almeno 15, con almeno 5 rigori.")

    def run(self) -> list[dict]:
        self.multi_goals("an_difensore_tripletta", "Defender", 3, False, "difensori", "ha segnato una tripletta", "difensore")
        self.multi_goals("an_difensore_doppietta", "Defender", 2, False, "difensori", "ha segnato due gol in una singola partita", "difensore")
        self.multi_goals("an_centrocampista_tripletta", "Midfield", 3, False, "centrocampisti", "ha segnato una tripletta", "centrocampista")
        self.multi_goals("an_portiere_gol", "Goalkeeper", 1, False, "portieri", "ha segnato un gol", "portiere")
        self.multi_goals("an_poker", "Attack", 4, False, "attaccanti", "ha segnato quattro gol in una partita", "attaccante")
        self.multi_goals("an_panchina_doppietta", None, 2, True, "giocatori", "è entrato dalla panchina e ha segnato due gol nella stessa partita", "panchina")
        self.multi_goals("an_difensore_subentrato", "Defender", 1, True, "difensori", "è entrato dalla panchina e ha segnato", "panchina")
        self.multi_goals("an_panchina_tripletta", None, 3, True, "giocatori", "è entrato dalla panchina e ha segnato tre gol nella stessa partita", "panchina")
        self.never_red()
        self.never_booked()
        self.gk_assist()
        self.defender_season()
        self.scoreless_forward()
        self.two_clubs()
        self.no_penalties()
        return self.out


def generate(t) -> dict[str, list[dict]]:
    return {"anomalia": Anomalie(t).run()}

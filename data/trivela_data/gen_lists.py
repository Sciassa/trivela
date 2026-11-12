"""Rankings (Dal Dischetto) and sets (La Decina, L'Asta), computed only on complete scopes."""

from __future__ import annotations

from collections import defaultdict

from .tm_core import (COMP_IT, IN_COMP, L5, OF_COMP, SNAPSHOT, SRC_DATASET, TM, age_label, base, nat_it, ranking,
                      season_label)

DECINA_RANGE = (14, 17)
ASTA_RANGE = (8, 30)


def scope(w: tuple[int, int]) -> str:
    return f"dal {season_label(w[0])} al {season_label(w[1])}" if w[0] != w[1] else f"stagione {season_label(w[0])}"


def gen_id(name: str, comp: str) -> str:
    return name if comp in ("IT1", "CL") else f"{name}@estero"


class Lists:
    def __init__(self, t: TM):
        self.t = t
        self.dischetto: list[dict] = []
        self.sets: list[dict] = []
        self.clubs = {"IT1": t.sa_clubs, **{lg: t.top_clubs[lg] for lg in L5 if lg != "IT1"}}
        cl = sorted(t.cl_weight, key=lambda c: -t.cl_weight[c])[:24]
        self.clubs["CL"] = cl
        self._load()

    # ------------------------------------------------------------------ data
    def _load(self) -> None:
        t = self.t
        comps = ",".join(f"'{c}'" for c in (*L5, "CL"))

        def table(sql: str):
            d = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))  # (comp, club) -> pid -> season -> value
            for comp, club, pid, season, v in t.q(sql):
                if pid is not None:
                    d[(comp, int(club))][int(pid)][int(season)] += int(v)
            return d

        self.goals = table(f"select gm.comp, pg.club, pg.pid, gm.season, sum(pg.goals) from pg join gm using(gid) where gm.comp in ({comps}) group by 1,2,3,4")
        self.apps = table(f"select gm.comp, p.club, p.pid, gm.season, count(distinct p.gid) from pres p join gm using(gid) where gm.comp in ({comps}) group by 1,2,3,4")
        self.caps = table(f"select gm.comp, l.club, l.pid, gm.season, count(*) from lu l join gm using(gid) where l.cap and l.starter and gm.comp in ({comps}) group by 1,2,3,4")
        self.subgoals = table(f"""select gm.comp, e.club, e.pid, gm.season, count(*) from goal e join gm using(gid)
            where not e.own and gm.comp in ({comps}) and exists(select 1 from sub s where s.gid = e.gid and s.pin = e.pid) group by 1,2,3,4""")
        self.headers = table(f"select gm.comp, e.club, e.pid, gm.season, count(*) from goal e join gm using(gid) where e.header and not e.own and gm.comp in ({comps}) group by 1,2,3,4")
        self.pens = table(f"select gm.comp, e.club, e.pid, gm.season, count(*) from goal e join gm using(gid) where e.pen and not e.own and gm.comp in ({comps}) group by 1,2,3,4")
        self.home_goals = table(f"select gm.comp, pg.club, pg.pid, gm.season, sum(pg.goals) from pg join gm using(gid) where pg.club = gm.home and gm.comp in ({comps}) group by 1,2,3,4")
        self.away_goals = table(f"select gm.comp, pg.club, pg.pid, gm.season, sum(pg.goals) from pg join gm using(gid) where pg.club = gm.away and gm.comp in ({comps}) group by 1,2,3,4")
        self.late = table(f"select gm.comp, e.club, e.pid, gm.season, count(*) from goal e join gm using(gid) where e.minute >= 80 and not e.own and gm.comp in ({comps}) group by 1,2,3,4")
        self.left = table(f"select gm.comp, e.club, e.pid, gm.season, count(*) from goal e join gm using(gid) where e.lf and not e.own and gm.comp in ({comps}) group by 1,2,3,4")
        self.subapps = table(f"select gm.comp, p.club, p.pid, gm.season, count(distinct p.gid) from pres p join gm using(gid) where p.starter = false and gm.comp in ({comps}) group by 1,2,3,4")
        self.reds = table(f"select gm.comp, r.club, r.pid, gm.season, count(*) from red r join gm using(gid) where gm.comp in ({comps}) group by 1,2,3,4")
        # goals against an opponent: (comp, opponent) -> pid -> season -> goals
        self.vs = table(f"""select gm.comp, case when pg.club = gm.home then gm.away else gm.home end, pg.pid, gm.season, sum(pg.goals)
            from pg join gm using(gid) where gm.comp in ({comps}) group by 1,2,3,4""")
        # first / last goal date per (comp, club, pid)
        self.goal_dates = defaultdict(dict)
        for comp, club, pid, season, d1, d2 in t.q(f"""select gm.comp, pg.club, pg.pid, gm.season, min(gm.date), max(gm.date) from pg join gm using(gid)
                where gm.comp in ({comps}) group by 1,2,3,4"""):
            self.goal_dates[(comp, int(club))].setdefault(int(pid), []).append((int(season), d1, d2))
        self.managers = defaultdict(lambda: defaultdict(set))  # (comp, club) -> name -> seasons
        for comp, club, name, season in t.q(f"""select comp, home, hman, season from gm where hman is not null and comp in ({comps})
                union select comp, away, aman, season from gm where aman is not null and comp in ({comps})"""):
            self.managers[(comp, int(club))][name].add(int(season))

    def total(self, table, key, w) -> dict[int, int]:
        out = {}
        for pid, by in table.get(key, {}).items():
            v = sum(n for s, n in by.items() if w[0] <= s <= w[1])
            if v:
                out[pid] = v
        return out

    # ------------------------------------------------------------------ helpers
    def add_rank(self, gen, key, title, definition, unit, values: dict[int, float], *, w, comp, ents, min10=2, labels=None,
                 reverse=True, max_ties=5, hint=None) -> None:
        t = self.t
        rows = [(t.pid(p), t.pname(p), v, (labels or {}).get(p)) for p, v in values.items()]
        rk = ranking(rows, reverse=reverse, max_ties=max_ties)
        if not rk:
            return
        tenth = [r for r in rk if r["rank"] == 10]
        if reverse and (not tenth or tenth[0]["value"] < min10):
            return
        first, last = rk[0], tenth[0] if tenth else rk[-1]
        if hint is None:
            if first.get("label"):
                hint = f"Il 1°: {first['label']} · il 10°: {last['label']}."
            else:
                hint = f"Il 1° ha {int(first['value'])} {unit}, il 10° ne ha {int(last['value'])}."
        top3 = ", ".join(f"{r['name']} ({r.get('label') or int(r['value'])})" for r in rk[:3])
        it = base(gen_id(gen, comp), key, year=w[0], year_max=w[1], fame=70, entities=ents + [r["id"] for r in rk], sources=[SRC_DATASET],
                  script=f"{title}: sul podio {top3}.")
        it.update({"title": title, "definition": definition, "unit": unit, "hint": hint, "ranking": rk, "snapshot": SNAPSHOT})
        self.dischetto.append(it)

    def add_set(self, gen, key, title, description, members: list[tuple[str, str]], *, w, comp, ents) -> None:
        n = len(members)
        if not ASTA_RANGE[0] <= n <= ASTA_RANGE[1]:
            return
        mem = sorted(({"id": i, "name": nm} for i, nm in dict(members).items()), key=lambda x: x["name"])
        it = base(gen_id(gen, comp), key, year=w[0], year_max=w[1], fame=70, entities=ents + [m["id"] for m in mem], sources=[SRC_DATASET],
                  script=f"{n} risposte valide: {', '.join(m['name'] for m in mem)}.")
        it.update({"title": title, "description": description, "members": mem})
        self.sets.append(it)

    def pm(self, pids) -> list[tuple[str, str]]:
        return [(self.t.pid(p), self.t.pname(p)) for p in pids]

    # ------------------------------------------------------------------ generators
    def run(self) -> None:
        t = self.t
        for comp, clubs in self.clubs.items():
            lg, inc = COMP_IT[comp], IN_COMP[comp]
            for club in clubs:
                name, key = t.club(club), (comp, club)
                ents = [f"comp:{comp}", t.cid(club)]
                wg, wp, wl, we = (t.window(comp, club, k) for k in ("goal", "pres", "lu", "ev"))
                dfn = lambda w: f"{lg}, {scope(w)} · dati Transfermarkt al 6 luglio 2026"  # noqa: E731
                if wg:
                    goals = self.total(self.goals, key, wg)
                    self.add_rank("dis_scorers", key, f"I 10 migliori marcatori {t.di(club)} {inc} ({scope(wg)})", dfn(wg), "gol", goals,
                                  w=wg, comp=comp, ents=ents, min10=5)
                    vs = self.total(self.vs, key, wg)
                    self.add_rank("dis_vs", key, f"I 10 giocatori che hanno segnato più gol {t.a(club)} {inc} ({scope(wg)})", dfn(wg), "gol", vs,
                                  w=wg, comp=comp, ents=ents, min10=2, max_ties=6)
                    self.add_rank("dis_home", key, f"I 10 migliori marcatori {t.di(club)} nelle partite in casa {inc} ({scope(wg)})", dfn(wg), "gol",
                                  self.total(self.home_goals, key, wg), w=wg, comp=comp, ents=ents, min10=3)
                    self.add_rank("dis_away", key, f"I 10 migliori marcatori {t.di(club)} in trasferta {inc} ({scope(wg)})", dfn(wg), "gol",
                                  self.total(self.away_goals, key, wg), w=wg, comp=comp, ents=ents, min10=3)
                    # youngest / oldest scorers
                    young, old, ly, lo = {}, {}, {}, {}
                    complete_dob = True
                    for pid, lst in self.goal_dates.get(key, {}).items():
                        ds = [(d1, d2) for s, d1, d2 in lst if wg[0] <= s <= wg[1]]
                        if not ds:
                            continue
                        dob = t.players.get(pid, {}).get("dob")
                        if not dob:
                            complete_dob = False
                            break
                        young[pid], ly[pid] = age_label(dob, min(d[0] for d in ds))
                        old[pid], lo[pid] = age_label(dob, max(d[1] for d in ds))
                    if complete_dob and len(young) >= 12:
                        self.add_rank("dis_young", key, f"I 10 marcatori più giovani {t.di(club)} {inc} ({scope(wg)})",
                                      dfn(wg) + " · età al primo gol", "", young, labels=ly, reverse=False, w=wg, comp=comp, ents=ents,
                                      hint=None)
                        self.add_rank("dis_old", key, f"I 10 marcatori più anziani {t.di(club)} {inc} ({scope(wg)})",
                                      dfn(wg) + " · età all'ultimo gol", "", old, labels=lo, w=wg, comp=comp, ents=ents, min10=0)
                if wp:
                    apps = self.total(self.apps, key, wp)
                    self.add_rank("dis_apps", key, f"I 10 giocatori con più presenze {t.con(club)} {inc} ({scope(wp)})", dfn(wp), "presenze", apps,
                                  w=wp, comp=comp, ents=ents, min10=30)
                    if wg and wg == wp:
                        goals = self.total(self.goals, key, wp)
                        dry = {p: v for p, v in apps.items() if p not in goals and t.known(p) and t.players[p]["line"] != "Goalkeeper"}
                        if all(t.known(p) for p in apps):
                            self.add_rank("dis_nogoal", key,
                                          f"I 10 giocatori di movimento con più presenze {t.con(club)} {inc} senza mai segnare ({scope(wp)})",
                                          dfn(wp) + " · portieri esclusi", "presenze", dry, w=wp, comp=comp, ents=ents, min10=8)
                    if all(t.known(p) and t.players[p]["height"] for p in apps):
                        heights = {p: int(t.players[p]["height"]) for p in apps}
                        self.add_rank("dis_tall", key, f"I 10 giocatori più alti scesi in campo {t.con(club)} {inc} ({scope(wp)})",
                                      dfn(wp) + " · altezza registrata da Transfermarkt", "cm", heights, w=wp, comp=comp, ents=ents, min10=150, max_ties=3)
                    # sets on presences
                    by_nat = defaultdict(list)
                    if all(t.known(p) for p in apps):
                        for p in apps:
                            by_nat[t.players[p]["nat"]].append(p)
                        home_nat = {"IT1": "Italy", "GB1": "England", "ES1": "Spain", "L1": "Germany", "FR1": "France"}.get(comp)
                        for nat, ps in by_nat.items():
                            if nat and nat != home_nat:
                                self.add_set("set_nat_club", (comp, club, nat),
                                             f"Giocatori di nazionalità {nat_it(nat)} scesi in campo {t.con(club)} {inc} ({scope(wp)})",
                                             f"Almeno una presenza. Nazionalità sportiva secondo Transfermarkt.", self.pm(ps), w=wp, comp=comp, ents=ents)
                        gks = [p for p in apps if t.players[p]["line"] == "Goalkeeper"]
                        self.add_set("set_gk", key, f"Portieri scesi in campo {t.con(club)} {inc} ({scope(wp)})", "Almeno una presenza.",
                                     self.pm(gks), w=wp, comp=comp, ents=ents)
                    cent = [p for p, v in apps.items() if v >= 100]
                    self.add_set("set_100", key, f"Giocatori con almeno 100 presenze {t.con(club)} {inc} ({scope(wp)})", "", self.pm(cent),
                                 w=wp, comp=comp, ents=ents)
                if wl:
                    self.add_rank("dis_subapps", key, f"I 10 giocatori con più ingressi dalla panchina {t.con(club)} {inc} ({scope(wl)})",
                                  dfn(wl) + " · presenze da subentrato", "ingressi", self.total(self.subapps, key, wl), w=wl, comp=comp, ents=ents, min10=8)
                    caps = self.total(self.caps, key, wl)
                    self.add_rank("dis_caps", key, f"I 10 giocatori con più partite da capitano {t.di(club)} {inc} ({scope(wl)})",
                                  dfn(wl) + " · da titolari con la fascia", "partite", caps, w=wl, comp=comp, ents=ents, min10=2)
                    self.add_set("set_caps", key, f"Giocatori che hanno indossato la fascia di capitano {t.di(club)} dal primo minuto {inc} ({scope(wl)})",
                                 "Almeno una partita da titolare con la fascia.", self.pm(caps), w=wl, comp=comp, ents=ents)
                if we:
                    sub = self.total(self.subgoals, key, we)
                    self.add_rank("dis_subgoals", key, f"I 10 giocatori {t.di(club)} con più gol da subentrati {inc} ({scope(we)})", dfn(we), "gol", sub,
                                  w=we, comp=comp, ents=ents, min10=2)
                    hd = self.total(self.headers, key, we)
                    self.add_rank("dis_headers", key, f"I 10 giocatori {t.di(club)} con più gol di testa {inc} ({scope(we)})", dfn(we), "gol", hd,
                                  w=we, comp=comp, ents=ents, min10=2)
                    self.add_rank("dis_late", key, f"I 10 giocatori {t.di(club)} con più gol segnati dall'80° minuto in poi {inc} ({scope(we)})",
                                  dfn(we), "gol", self.total(self.late, key, we), w=we, comp=comp, ents=ents, min10=2, max_ties=6)
                    self.add_rank("dis_left", key, f"I 10 giocatori {t.di(club)} con più gol di sinistro {inc} ({scope(we)})",
                                  dfn(we), "gol", self.total(self.left, key, we), w=we, comp=comp, ents=ents, min10=3)
                    reds = self.total(self.reds, key, we)
                    self.add_set("set_red", key, f"Giocatori espulsi con la maglia {t.di(club)} {inc} ({scope(we)})",
                                 "Rosso diretto o doppia ammonizione.", self.pm(reds), w=we, comp=comp, ents=ents)
                # managers (names from the match sheets)
                wm = wp or wg
                if wm and comp != "CL":
                    mans = [n for n, ss in self.managers.get(key, {}).items() if any(wm[0] <= s <= wm[1] for s in ss)]
                    self.add_set("set_managers", key, f"Allenatori che hanno guidato {t.il(club)} in panchina {inc} ({scope(wm)})",
                                 "Almeno una partita secondo i tabellini.", [(t.mid(n), n) for n in mans], w=wm, comp=comp, ents=ents)
                if wp:
                    for s in range(wp[0], wp[1] + 1):
                        seas = {p: by.get(s, 0) for p, by in self.apps.get(key, {}).items() if by.get(s)}
                        if not seas:
                            continue
                        if comp == "CL":
                            self.add_set("set_cl_squad", (comp, club, s), f"Giocatori scesi in campo {t.con(club)} nella Champions League {season_label(s)}",
                                         "Almeno una presenza, qualificazioni escluse.", self.pm(seas), w=(s, s), comp=comp, ents=ents)
                            continue
                        for thr in (20, 25, 15, 30):
                            reg = [p for p, v in seas.items() if v >= thr]
                            if DECINA_RANGE[0] <= len(reg) <= DECINA_RANGE[1]:
                                self.add_set("set_regulars", (comp, club, s, thr),
                                             f"Giocatori con almeno {thr} presenze {t.con(club)} {self.in_season(comp, s)}", "Presenze in campionato.",
                                             self.pm(reg), w=(s, s), comp=comp, ents=ents)
                                break
                # per-season sets
                if wg:
                    for s in range(wg[0], wg[1] + 1):
                        sc = [p for p, by in self.goals.get(key, {}).items() if by.get(s)]
                        if sc:
                            self.add_set("set_season_scorers", (comp, club, s), f"Tutti i marcatori {t.di(club)} {self.in_season(comp, s)}",
                                         "Autogol esclusi.", self.pm(sc), w=(s, s), comp=comp, ents=ents)
                        ag = [p for p, by in self.vs.get(key, {}).items() if by.get(s)]
                        if ag and comp != "CL":
                            self.add_set("set_season_against", (comp, club, s), f"Giocatori che hanno segnato {t.a(club)} {self.in_season(comp, s)}",
                                         "Autogol esclusi.", self.pm(ag), w=(s, s), comp=comp, ents=ents)
            self.doppi_ex(comp, clubs)
            self.fixtures(comp, clubs)
        self.cross_league()
        self.league_level()

    def in_season(self, comp: str, s: int) -> str:
        return f"{'nella ' + COMP_IT[comp]} {season_label(s)}"

    def doppi_ex(self, comp: str, clubs: list[int]) -> None:
        t = self.t
        if comp == "CL":
            return
        played = {}
        for c in clubs:
            w = t.window(comp, c, "pres")
            if w:
                played[c] = (w, set(self.total(self.apps, (comp, c), w)))
        cs = list(played)
        for i, a in enumerate(cs):
            for b in cs[i + 1:]:
                (wa, pa), (wb, pb) = played[a], played[b]
                w = (max(wa[0], wb[0]), min(wa[1], wb[1]))
                if w[0] > w[1] or wa != wb:
                    pa2 = set(self.total(self.apps, (comp, a), w))
                    pb2 = set(self.total(self.apps, (comp, b), w))
                    if w[0] > w[1]:
                        continue
                else:
                    pa2, pb2 = pa, pb
                both = pa2 & pb2
                self.add_set("set_doppi_ex", (comp, a, b),
                             f"Doppi ex: giocatori scesi in campo {IN_COMP[comp]} sia {t.con(a)} sia {t.con(b)} ({scope(w)})",
                             "Almeno una presenza in campionato con entrambe.", self.pm(both), w=w, comp=comp, ents=[f"comp:{comp}", t.cid(a), t.cid(b)])

    def fixtures(self, comp: str, clubs: list[int]) -> None:
        t = self.t
        if comp == "CL":
            return
        top = clubs[:10]
        rows = t.q(f"""select gm.home, gm.away, pg.pid, gm.season from pg join gm using(gid) where gm.comp = '{comp}'""")
        fx = defaultdict(lambda: defaultdict(set))
        for h, a, pid, s in rows:
            fx[tuple(sorted((int(h), int(a))))][int(s)].add(int(pid))
        for i, a in enumerate(top):
            for b in top[i + 1:]:
                wa, wb = t.window(comp, a, "goal"), t.window(comp, b, "goal")
                if not wa or not wb:
                    continue
                w = (max(wa[0], wb[0]), min(wa[1], wb[1]))
                if w[0] > w[1]:
                    continue
                ps = set().union(*[v for s, v in fx[tuple(sorted((a, b)))].items() if w[0] <= s <= w[1]] or [set()])
                self.add_set("set_fixture", (comp, a, b), f"Tutti i marcatori delle sfide tra {t.club(a)} e {t.club(b)} {IN_COMP[comp]} ({scope(w)})",
                             "Andata e ritorno, autogol esclusi.", self.pm(ps), w=w, comp=comp, ents=[f"comp:{comp}", t.cid(a), t.cid(b)])

    def cross_league(self) -> None:
        """Doppi ex between an Italian top club and a foreign top club (league appearances on both sides)."""
        t = self.t
        for a in t.top_clubs["IT1"]:
            wa = t.window("IT1", a, "pres")
            if not wa:
                continue
            pa = set(self.total(self.apps, ("IT1", a), wa))
            for lg in ("GB1", "ES1", "L1", "FR1"):
                for b in t.top_clubs[lg][:6]:
                    wb = t.window(lg, b, "pres")
                    if not wb:
                        continue
                    both = pa & set(self.total(self.apps, (lg, b), wb))
                    w = (min(wa[0], wb[0]), max(wa[1], wb[1]))
                    self.add_set("set_doppi_ex_europa", (a, b),
                                 f"Doppi ex: giocatori scesi in campo in campionato sia {t.con(a)} ({scope(wa)}) sia {t.con(b)} ({scope(wb)})",
                                 f"Presenze in Serie A e in {COMP_IT[lg]}.", self.pm(both), w=w, comp="IT1", ents=["comp:IT1", t.cid(a), t.cid(b)])

    def league_level(self) -> None:
        t = self.t
        for comp in (*L5, "CL"):
            lg, inc = COMP_IT[comp], IN_COMP[comp]
            ents = [f"comp:{comp}"]
            wg, wp, we = t.window(comp, None, "goal", 1), t.window(comp, None, "pres", 1), t.window(comp, None, "ev", 1)
            vg = t.valid_seasons(comp, None, "goal")
            # per-season top scorers and hat-tricks
            season_goals = defaultdict(lambda: defaultdict(int))
            for (c, _club), by in self.goals.items():
                if c == comp:
                    for pid, ss in by.items():
                        for s, n in ss.items():
                            season_goals[s][pid] += n
            for s, ok in vg.items():
                if not ok:
                    continue
                self.add_rank("dis_season_top", (comp, s), f"I 10 migliori marcatori {OF_COMP[comp]} {season_label(s)}",
                              f"{lg} {season_label(s)} · autogol esclusi", "gol", dict(season_goals[s]), w=(s, s), comp=comp, ents=ents, min10=5)
                if comp != "CL":
                    by_nat = defaultdict(list)
                    if all(t.known(p) for p in season_goals[s]):
                        for p in season_goals[s]:
                            by_nat[t.players[p]["nat"]].append(p)
                        home_nat = {"IT1": "Italy", "GB1": "England", "ES1": "Spain", "L1": "Germany", "FR1": "France"}[comp]
                        for nat, ps in by_nat.items():
                            if nat and nat != home_nat:
                                self.add_set("set_season_nat_scorers", (comp, s, nat),
                                             f"Marcatori di nazionalità {nat_it(nat)} nella {lg} {season_label(s)}", "Autogol esclusi.",
                                             self.pm(ps), w=(s, s), comp=comp, ents=ents)
            if wg:
                tot = defaultdict(int)
                for s in range(wg[0], wg[1] + 1):
                    for pid, n in season_goals[s].items():
                        tot[pid] += n
                if all(t.known(p) for p in tot):
                    by_nat = defaultdict(dict)
                    for p, n in tot.items():
                        by_nat[t.players[p]["nat"]][p] = n
                    home_nat = {"IT1": "Italy", "GB1": "England", "ES1": "Spain", "L1": "Germany", "FR1": "France"}.get(comp)
                    for nat, vals in by_nat.items():
                        if nat and nat != home_nat:
                            self.add_rank("dis_nat_scorers", (comp, nat), f"I 10 migliori marcatori di nazionalità {nat_it(nat)} {inc} ({scope(wg)})",
                                          f"{lg}, {scope(wg)} · nazionalità sportiva secondo Transfermarkt", "gol", vals, w=wg, comp=comp, ents=ents, min10=3)
            if wp and wg:
                w = (max(wp[0], wg[0]), min(wp[1], wg[1]))
                if w[0] <= w[1]:
                    apps, goals = defaultdict(int), defaultdict(int)
                    for (c, _club), by in self.apps.items():
                        if c == comp:
                            for pid, ss in by.items():
                                apps[pid] += sum(n for s, n in ss.items() if w[0] <= s <= w[1])
                    for s in range(w[0], w[1] + 1):
                        for pid, n in season_goals[s].items():
                            goals[pid] += n
                    apps = {p: v for p, v in apps.items() if v}
                    if all(t.known(p) for p in apps):
                        dry = {p: v for p, v in apps.items() if not goals.get(p) and t.players[p]["line"] != "Goalkeeper"}
                        self.add_rank("dis_league_nogoal", comp, f"I 10 giocatori di movimento con più presenze {inc} senza mai segnare ({scope(w)})",
                                      f"{lg}, {scope(w)} · portieri esclusi", "presenze", dry, w=w, comp=comp, ents=ents, min10=20)
                        self.add_rank("dis_league_apps", comp, f"I 10 giocatori con più presenze {inc} ({scope(w)})", f"{lg}, {scope(w)}", "presenze",
                                      apps, w=w, comp=comp, ents=ents, min10=50)
            if wg:
                young, old, ly, lo, okd = {}, {}, {}, {}, True
                for (c, _club), by in self.goal_dates.items():
                    if c != comp:
                        continue
                    for pid, lst in by.items():
                        ds = [(d1, d2) for s, d1, d2 in lst if wg[0] <= s <= wg[1]]
                        if not ds:
                            continue
                        dob = t.players.get(pid, {}).get("dob")
                        if not dob:
                            okd = False
                            continue
                        a1, l1 = age_label(dob, min(d[0] for d in ds))
                        a2, l2 = age_label(dob, max(d[1] for d in ds))
                        if pid not in young or a1 < young[pid]:
                            young[pid], ly[pid] = a1, l1
                        if pid not in old or a2 > old[pid]:
                            old[pid], lo[pid] = a2, l2
                if okd:
                    self.add_rank("dis_league_young", comp, f"I 10 marcatori più giovani {inc} ({scope(wg)})", f"{lg}, {scope(wg)} · età al primo gol", "",
                                  young, labels=ly, reverse=False, w=wg, comp=comp, ents=ents)
                    self.add_rank("dis_league_old", comp, f"I 10 marcatori più anziani {inc} ({scope(wg)})", f"{lg}, {scope(wg)} · età all'ultimo gol", "",
                                  old, labels=lo, w=wg, comp=comp, ents=ents, min10=0)
            if wp:
                apps_nat = defaultdict(dict)
                tot_apps = defaultdict(int)
                for (c, _club), by in self.apps.items():
                    if c == comp:
                        for pid, ss in by.items():
                            tot_apps[pid] += sum(n for s, n in ss.items() if wp[0] <= s <= wp[1])
                if all(t.known(p) for p, v in tot_apps.items() if v):
                    for p, v in tot_apps.items():
                        if v:
                            apps_nat[t.players[p]["nat"]][p] = v
                    home_nat = {"IT1": "Italy", "GB1": "England", "ES1": "Spain", "L1": "Germany", "FR1": "France"}.get(comp)
                    for nat, vals in apps_nat.items():
                        if nat and nat != home_nat:
                            self.add_rank("dis_nat_apps", (comp, nat), f"I 10 giocatori di nazionalità {nat_it(nat)} con più presenze {inc} ({scope(wp)})",
                                          f"{lg}, {scope(wp)} · nazionalità sportiva secondo Transfermarkt", "presenze", vals, w=wp, comp=comp, ents=ents, min10=20)
            if we:
                for table, gen, what in ((self.subgoals, "dis_league_subgoals", "gol da subentrati"), (self.headers, "dis_league_headers", "gol di testa"),
                                         (self.pens, "dis_league_pens", "rigori segnati"), (self.late, "dis_league_late", "gol segnati dall'80° minuto in poi"),
                                         (self.left, "dis_league_left", "gol di sinistro")):
                    tot = defaultdict(int)
                    for (c, _club), by in table.items():
                        if c == comp:
                            for pid, ss in by.items():
                                tot[pid] += sum(n for s, n in ss.items() if we[0] <= s <= we[1])
                    self.add_rank(gen, comp, f"I 10 giocatori con più {what} {inc} ({scope(we)})", f"{lg}, {scope(we)}", "gol",
                                  {p: v for p, v in tot.items() if v}, w=we, comp=comp, ents=ents, min10=3)


def generate(t: TM) -> dict[str, list[dict]]:
    ls = Lists(t)
    ls.run()
    decina = [dict(it, id=it["id"] + "d") for it in ls.sets if DECINA_RANGE[0] <= len(it["members"]) <= DECINA_RANGE[1]]
    return {"dischetto": ls.dischetto, "decina": decina, "asta": ls.sets}

"""Tiro Secco: multiple-choice curiosities computed on the verified facts layer.

Every question has one provably true option and three options checked to be false on the same data.
"""

from __future__ import annotations

import datetime as dt
import random
from collections import Counter, defaultdict

from . import managers as managers_mod
from .gen_matches import weight
from .tm_core import COMP_IT, IN_COMP, L5, MONTHS, OF_COMP, SRC_DATASET, TM, WEEKDAYS, base, date_it, opts4, season_label

QUIZ_COMPS = (*L5, "CL")
START, END = dt.date(2012, 8, 1), dt.date(2026, 7, 6)
FEASTS = [(12, 26, "Santo Stefano"), (1, 1, "Capodanno"), (2, 29, "il 29 febbraio"), (12, 31, "San Silvestro"), (8, 15, "Ferragosto"),
          (1, 6, "l'Epifania"), (11, 1, "Ognissanti"), (4, 25, "il 25 aprile"), (5, 1, "il Primo maggio"), (12, 24, "la vigilia di Natale")]


class Quiz:
    def __init__(self, t: TM):
        self.t = t
        self.out: list[dict] = []
        comps = ",".join(f"'{c}'" for c in QUIZ_COMPS)
        self.G = {g["gid"]: g for g in t.games()}
        self.goal_ok = {r[0] for r in t.q("select gid from g_goal_ok")}
        self.lu_ok = {r[0] for r in t.q("select gid from g_lu_ok")}
        self.goals = defaultdict(list)
        for gid, minute, club, pid, own in t.q("select gid, minute, club, pid, own from goal order by gid, minute"):
            self.goals[gid].append((int(minute), int(club), int(pid), own))
        self.pgoals = defaultdict(list)  # pid -> [(date, comp, season, gid, club, goals)]
        for pid, gid, club, n in t.q("select pid, gid, club, goals from pg"):
            g = self.G[gid]
            self.pgoals[int(pid)].append((g["date"], g["comp"], g["season"], gid, int(club), int(n)))
        self.scored_on = {(pid, d, comp) for pid, lst in self.pgoals.items() for d, comp, *_ in lst}
        self.bad_dates = defaultdict(set)  # comp -> dates with a goal-incomplete game
        self.bad_games = defaultdict(list)
        for g in self.G.values():
            if g["gid"] not in self.goal_ok:
                self.bad_dates[g["comp"]].add(g["date"])
                self.bad_games[g["comp"]].append(g)
        self.in_lineup = defaultdict(set)  # pid -> gids (starter or bench)
        for pid, gid in t.q("select pid, gid from lu"):
            self.in_lineup[int(pid)].add(gid)
        self.first_seen = {int(p): d for p, d in t.q("select p.pid, min(gm.date) from pres p join gm using(gid) group by 1")}
        self.season_players = defaultdict(set)  # (comp, season) -> notable players with a presence
        self.pres_count = Counter()
        self.player_opps = defaultdict(set)  # (pid, comp, season) -> opponents faced
        for pid, gid, club in t.q(f"select p.pid, p.gid, p.club from pres p join gm using(gid) where gm.comp in ({comps})"):
            g = self.G[gid]
            pid = int(pid)
            self.pres_count[(pid, g["comp"])] += 1
            self.player_opps[(pid, g["comp"], g["season"])].add(g["away"] if int(club) == g["home"] else g["home"])
            if t.is_notable(pid):
                self.season_players[(g["comp"], g["season"])].add(pid)
        self.club_games = defaultdict(list)  # (comp, season, club) -> games
        for g in self.G.values():
            self.club_games[(g["comp"], g["season"], g["home"])].append(g)
            self.club_games[(g["comp"], g["season"], g["away"])].append(g)
        self.mdob = {n: dt.date.fromisoformat(v["dob"]) for n, v in managers_mod.load().items()}

    # ------------------------------------------------------------------ helpers
    def add(self, gen: str, key, question: str, correct: str, distractors: list[str], *, year: int, fame: int, script: str, sources: list[dict],
            entities: list[str], archetype: int, comp: str | None = None, active: list[int] | None = None) -> bool:
        o = opts4(correct, distractors, f"{gen}-{key}")
        if not o:
            return False
        g = gen if comp in (None, "IT1", "CL") else f"{gen}@estero"
        it = base(g, key, year=year, fame=fame, entities=entities, sources=sources, script=script, active=active)
        it.update({"question": question, "options": o[0], "correct": o[1], "archetype": archetype})
        self.out.append(it)
        return True

    def clean_history(self, pid: int, comp: str, until: dt.date) -> bool:
        """No goal-incomplete game of `comp` before `until` in which the player could have scored."""
        first = self.first_seen.get(pid, END)
        for g in self.bad_games.get(comp, []):
            if g["date"] >= until:
                continue
            if g["gid"] in self.in_lineup.get(pid, ()):
                return False
            if g["gid"] not in self.lu_ok and g["date"] >= first:
                return False
        return True

    def peers(self, pid: int, comp: str, season: int, k: int = 40) -> list[int]:
        t = self.t
        yob = (t.players[pid]["dob"] or dt.date(1990, 1, 1)).year
        pool = set()
        for s in (season - 1, season, season + 1):
            pool |= self.season_players.get((comp, s), set())
        pool.discard(pid)
        return sorted((p for p in pool if t.players[p]["dob"] and abs(t.players[p]["dob"].year - yob) <= 5), key=lambda p: -t.fame(p))[:k]

    # ------------------------------------------------------------------ T1 birthday goals
    def birthday_goals(self) -> None:
        t = self.t
        for pid, lst in self.pgoals.items():
            p = t.players.get(pid)
            if not p or not p["dob"] or not t.is_notable(pid):
                continue
            seen = set()
            for d, comp, season, gid, club, n in sorted(lst):
                if comp not in QUIZ_COMPS or (d.month, d.day) != (p["dob"].month, p["dob"].day) or comp in seen:
                    continue
                seen.add(comp)
                age = d.year - p["dob"].year
                ds = []
                for q in self.peers(pid, comp, season):
                    dob = t.players[q]["dob"]
                    try:
                        bday = dob.replace(year=dob.year + age)
                    except ValueError:
                        continue
                    if START <= bday <= END and bday not in self.bad_dates[comp] and (q, bday, comp) not in self.scored_on:
                        ds.append(t.pname(q))
                g = self.G[gid]
                self.add("ts_compleanno", (pid, comp), f"Quale di questi giocatori ha segnato {IN_COMP[comp]} nel giorno del suo {age}° compleanno?",
                         t.pname(pid), ds, year=d.year, fame=t.fame(pid), comp=comp, archetype=1, entities=[f"comp:{comp}", t.pid(pid)],
                         sources=[t.src_player(pid), t.src_game(g)],
                         script=f"{t.pname(pid)}, nato il {date_it(p['dob'])}, ha segnato in {t.label(g)} ({t.ctx(g)}) il {date_it(d)}: "
                                f"era il giorno del suo {age}° compleanno.")

    # ------------------------------------------------------------------ T2 the only game on a weekday
    def unique_weekday(self) -> None:
        t = self.t
        clubs = {"IT1": t.sa_clubs[:16], **{lg: t.top_clubs[lg][:4] for lg in L5 if lg != "IT1"}}
        for comp, cs in clubs.items():
            for club in cs:
                for season in range(2012, 2026):
                    games = self.club_games.get((comp, season, club), [])
                    if len(games) < 30:
                        continue
                    wd = Counter(g["date"].weekday() for g in games)
                    for day in (0, 1, 3, 4):
                        if wd.get(day) != 1:
                            continue
                        tg = next(g for g in games if g["date"].weekday() == day)
                        self.add("ts_giorno", (comp, season, club, day),
                                 f"Qual è stata l'unica partita {OF_COMP[comp]} {season_label(season)} che {t.il(club)} ha giocato di {WEEKDAYS[day]}?",
                                 t.label(tg), [t.label(g) for g in games if g is not tg], year=season, fame=60, comp=comp, archetype=1,
                                 entities=[f"comp:{comp}", t.cid(club)], sources=[t.src_game(tg), SRC_DATASET],
                                 script=f"Nella {COMP_IT[comp]} {season_label(season)} {t.il(club)} ha giocato di {WEEKDAYS[day]} una sola volta: "
                                        f"{t.label(tg)}, {date_it(tg['date'])}.")

    # ------------------------------------------------------------------ T3 born on the very same day
    def same_birthdate(self) -> None:
        t = self.t
        rows = t.q("""select a.gid, a.pid, b.pid from lu a join lu b on a.gid = b.gid and a.pid < b.pid
                      join players pa on pa.player_id = a.pid join players pb on pb.player_id = b.pid
                      where a.starter and b.starter and pa.date_of_birth is not null and pa.date_of_birth = pb.date_of_birth""")
        best = {}
        for gid, a, b in rows:
            a, b = int(a), int(b)
            if not (t.is_notable(a) and t.is_notable(b)) or gid not in self.lu_ok:
                continue
            g = self.G[gid]
            if (a, b) not in best or weight(t, g) > weight(t, best[(a, b)]):
                best[(a, b)] = g
        starters = defaultdict(list)
        ids = ",".join(str(g["gid"]) for g in best.values()) or "0"
        for gid, pid in t.q(f"select gid, pid from lu where starter and gid in ({ids})"):
            starters[gid].append(int(pid))
        for (a, b), g in best.items():
            r = random.Random(f"{a}-{b}")
            pool = [p for p in starters[g["gid"]] if t.is_notable(p) and p not in (a, b) and t.players[p]["dob"]]
            ds = []
            for _ in range(30):
                if len(pool) < 2:
                    break
                x, y = r.sample(pool, 2)
                if t.players[x]["dob"] != t.players[y]["dob"]:
                    ds.append(f"{t.pname(x)} e {t.pname(y)}")
            dob = t.players[a]["dob"]
            self.add("ts_gemelli", (a, b), f"Quali due titolari di {t.label(g)} ({t.ctx(g)}) sono nati esattamente lo stesso giorno?",
                     f"{t.pname(a)} e {t.pname(b)}", ds, year=g["date"].year, fame=min(t.fame(a), t.fame(b)), comp=g["comp"], archetype=1,
                     entities=[f"comp:{g['comp']}", t.pid(a), t.pid(b)], sources=[t.src_player(a), t.src_player(b)],
                     script=f"{t.pname(a)} e {t.pname(b)} sono nati entrambi il {date_it(dob)}.")

    # ------------------------------------------------------------------ T4 managers and birthdays
    def managers(self) -> None:
        t = self.t
        md = self.mdob
        if not md:
            return
        by_season = defaultdict(set)
        meet = defaultdict(list)
        for g in self.G.values():
            h, a = g["hman"], g["aman"]
            if h in md and a in md and h != a:
                pair = tuple(sorted((h, a)))
                by_season[(g["comp"], g["season"])].add(pair)
                meet[pair].append(g)
        bd = lambda n: (md[n].month, md[n].day)  # noqa: E731
        src = {"family": "wikidata", "label": "Wikidata: date di nascita degli allenatori", "url": "https://www.wikidata.org"}
        for pair, games in meet.items():
            x, y = pair
            if bd(x) != bd(y):
                continue
            on_day = [g for g in games if (g["date"].month, g["date"].day) == bd(x)]
            g = on_day[0] if on_day else max(games, key=lambda z: weight(t, z))
            others = [f"{p} e {q}" for p, q in by_season[(g["comp"], g["season"])] if bd(p) != bd(q) and {p, q} != {x, y}]
            day = f"{md[x].day} {MONTHS[md[x].month - 1]}"
            if on_day:
                q = f"Quali due allenatori si sono affrontati {IN_COMP[g['comp']]} proprio nel giorno in cui entrambi compivano gli anni?"
                s = f"{x} ({md[x].year}) e {y} ({md[y].year}) sono nati entrambi il {day}: quel giorno, nel {g['date'].year}, si sono affrontati in {t.label(g)} ({t.ctx(g)})."
            else:
                q = f"Quale di queste coppie di allenatori, avversari {IN_COMP[g['comp']]} nel {season_label(g['season'])}, festeggia il compleanno lo stesso giorno?"
                s = f"{x} ({md[x].year}) e {y} ({md[y].year}) sono nati entrambi il {day}. Si sono affrontati, tra le altre, in {t.label(g)} ({t.ctx(g)})."
            self.add("ts_allenatori_gemelli", pair, q, f"{x} e {y}", others, year=g["date"].year, fame=75, comp=g["comp"], archetype=1,
                     entities=[f"comp:{g['comp']}", t.mid(x), t.mid(y)], sources=[t.src_game(g), src], script=s)
        # a win on the manager's own birthday
        wins = defaultdict(list)
        count = Counter()
        for g in self.G.values():
            for man, mine, theirs in ((g["hman"], g["fh"], g["fa"]), (g["aman"], g["fa"], g["fh"])):
                if man in md and g["comp"] in QUIZ_COMPS and not g["pens"]:
                    count[(man, g["comp"])] += 1
                    if (g["date"].month, g["date"].day) == bd(man) and mine > theirs:
                        wins[(man, g["comp"])].append(g)
        for (man, comp), games in wins.items():
            g = games[0]
            ds = [m for (m, c), n in count.items() if c == comp and n >= 40 and (m, comp) not in wins and m != man]
            ds = random.Random(man).sample(sorted(ds), min(12, len(ds)))
            age = g["date"].year - md[man].year
            self.add("ts_allenatore_compleanno", (man, comp),
                     f"Quale di questi allenatori ha vinto una partita {IN_COMP[comp]} nel giorno del suo compleanno (tra il 2012/13 e il 2025/26)?",
                     man, ds, year=g["date"].year, fame=70, comp=comp, archetype=1, entities=[f"comp:{comp}", t.mid(man)],
                     sources=[t.src_game(g), src],
                     script=f"{man}, nato il {date_it(md[man])}, ha vinto {t.label(g)} ({t.ctx(g)}) il {date_it(g['date'])}: compiva {age} anni.")

    # ------------------------------------------------------------------ T5 goal and own goal in the same game
    def goal_and_own_goal(self) -> None:
        t = self.t
        for gid, gl in self.goals.items():
            g = self.G[gid]
            own = {x[2] for x in gl if x[3]}
            reg = {x[2] for x in gl if not x[3]}
            for pid in own & reg:
                if not t.is_notable(pid):
                    continue
                ds = [t.pname(x[2]) for x in gl if x[2] != pid] + [t.pname(p) for p in self.starters(gid) if p != pid and t.is_notable(p)]
                self.add("ts_gol_autogol", (gid, pid), f"Chi ha segnato sia un gol sia un'autorete in {t.label(g)} ({t.ctx(g)})?", t.pname(pid), ds,
                         year=g["date"].year, fame=t.fame(pid), comp=g["comp"], archetype=2, entities=[f"comp:{g['comp']}", t.pid(pid)],
                         sources=[t.src_game(g)],
                         script=f"In {t.label(g)} ({date_it(g['date'])}) {t.pname(pid)} ha segnato sia nella porta giusta sia in quella sbagliata.")

    def starters(self, gid: int) -> list[int]:
        if not hasattr(self, "_st"):
            self._st = defaultdict(list)
            for g2, pid in self.t.q("select gid, pid from lu where starter"):
                self._st[g2].append(int(pid))
        return self._st.get(gid, [])

    # ------------------------------------------------------------------ T6 sent off minutes after coming on
    def quick_red(self) -> None:
        t = self.t
        rows = t.q("""select s.gid, s.pin, s.minute, r.minute from sub s join red r on r.gid = s.gid and r.pid = s.pin
                      where r.minute - s.minute between 1 and 8""")
        subs = defaultdict(list)
        ids = ",".join(str(r[0]) for r in rows) or "0"
        for gid, pin in t.q(f"select gid, pin from sub where gid in ({ids})"):
            subs[gid].append(int(pin))
        for gid, pid, a, b in rows:
            pid, g = int(pid), self.G[gid]
            if not t.is_notable(pid) or g["comp"] not in (*QUIZ_COMPS, "EL", "CIT"):
                continue
            k = int(b - a)
            ds = [t.pname(p) for p in subs[gid] if p != pid and t.known(p)]
            self.add("ts_rosso_lampo", (gid, pid),
                     f"In {t.label(g)} ({t.ctx(g)}) chi è stato espulso {'un minuto' if k == 1 else f'{k} minuti'} dopo essere entrato in campo?",
                     t.pname(pid), ds, year=g["date"].year, fame=t.fame(pid), comp=g["comp"], archetype=2,
                     entities=[f"comp:{g['comp']}", t.pid(pid)], sources=[t.src_game(g)],
                     script=f"{t.pname(pid)} è entrato al {a}' ed è stato espulso al {b}' di {t.label(g)} ({date_it(g['date'])}).")

    # ------------------------------------------------------------------ T7 comeback from two goals down
    def comebacks(self) -> None:
        t = self.t
        found = defaultdict(list)
        for gid, gl in self.goals.items():
            g = self.G[gid]
            if g["comp"] not in QUIZ_COMPS or g["pens"] or len(gl) < 5 or g["fh"] == g["fa"]:
                continue
            mins = Counter(x[0] for x in gl)
            if any(n > 1 for n in mins.values()):
                continue  # order of the goals inside the same minute is unknown
            h = a = 0
            worst = 0
            winner_home = g["fh"] > g["fa"]
            low = None
            for minute, club, _pid, _own in gl:
                if club == g["home"]:
                    h += 1
                else:
                    a += 1
                deficit = (a - h) if winner_home else (h - a)
                if deficit > worst:
                    worst, low = deficit, (h, a, minute)
            if worst >= 2:
                found[(g["comp"], g["season"], g["home"] if winner_home else g["away"])].append((g, low))
        for (comp, season, club), lst in found.items():
            if len(lst) != 1 or not (club in t.sa_clubs or club in t.top_clubs.get(comp, [])[:6] or comp == "CL" and club in t.big):
                continue
            if not t.valid_seasons(comp, club, "ev").get(season):
                continue
            g, low = lst[0]
            opp = g["away"] if club == g["home"] else g["home"]
            others = [t.club(x["away"] if x["home"] == club else x["home"]) for x in self.club_games[(comp, season, club)]]
            self.add("ts_rimonta", (comp, season, club),
                     f"{COMP_IT[comp]} {season_label(season)}: contro quale squadra {t.il(club)} ha vinto dopo essere finit{'a' if t.di(club).startswith('della') else 'o'} sotto di due gol?",
                     t.club(opp), [o for o in others if o != t.club(opp)], year=season, fame=65, comp=comp, archetype=2,
                     entities=[f"comp:{comp}", t.cid(club), t.cid(opp)], sources=[t.src_game(g)],
                     script=f"{t.label(g)} ({t.ctx(g)}, {date_it(g['date'])}): al {low[2]}' il punteggio era {low[0]}-{low[1]}, poi la rimonta. "
                            f"È l'unica vittoria di quella stagione arrivata dopo due gol di svantaggio.")

    # ------------------------------------------------------------------ T8 the short-lived manager
    def short_managers(self) -> None:
        t = self.t
        clubs = {"IT1": t.sa_clubs, **{lg: t.top_clubs[lg][:8] for lg in L5 if lg != "IT1"}}
        by_club = defaultdict(lambda: defaultdict(list))
        for g in self.G.values():
            if g["comp"] in L5:
                for club, man in ((g["home"], g["hman"]), (g["away"], g["aman"])):
                    if man:
                        by_club[(g["comp"], club)][g["season"]].append((man, g))
        for (comp, club), seasons in by_club.items():
            if club not in clubs[comp]:
                continue
            for season, lst in seasons.items():
                cnt = Counter(m for m, _ in lst)
                if len(cnt) < 3:
                    continue
                man, n = min(cnt.items(), key=lambda kv: (kv[1], kv[0]))
                if n > 6 or sum(1 for v in cnt.values() if v == n) > 1:
                    continue
                g = min((x for m, x in lst if m == man), key=lambda x: x["date"])
                near = {m for s in (season - 1, season, season + 1) for m, _ in seasons.get(s, [])} - {man}
                self.add("ts_panchina", (comp, club, season),
                         f"Chi sedeva sulla panchina {t.di(club)} in {t.label(g)} del {date_it(g['date'])} ({t.ctx(g)})?",
                         man, sorted(near), year=season, fame=60, comp=comp, archetype=3, entities=[f"comp:{comp}", t.cid(club), t.mid(man)],
                         sources=[t.src_game(g)],
                         script=f"In quella stagione {t.il(club)} ha cambiato {len(cnt)} allenatori: {man} risulta in panchina solo in {n} "
                                f"partit{'a' if n == 1 else 'e'} di campionato.")

    # ------------------------------------------------------------------ T9 goals on special days
    def feast_goals(self) -> None:
        t = self.t
        by_day = defaultdict(list)
        for pid, lst in self.pgoals.items():
            for d, comp, season, gid, club, n in lst:
                if comp in ("IT1", "GB1"):
                    by_day[(comp, d)].append((pid, gid))
        for (comp, d), lst in by_day.items():
            feast = next((name for m, dd, name in FEASTS if (m, dd) == (d.month, d.day)), None)
            if not feast or d in self.bad_dates[comp]:
                continue
            season = self.G[lst[0][1]]["season"]
            scorers = {p for p, _ in lst}
            pool = [p for p in self.season_players[(comp, season)] if p not in scorers and any(x[1] == comp and x[2] == season for x in self.pgoals.get(p, []))]
            pool = sorted(pool, key=lambda p: -t.fame(p))[:30]
            for pid, gid in sorted(lst, key=lambda x: -t.fame(x[0]))[:3]:
                if not t.is_notable(pid):
                    continue
                g = self.G[gid]
                label = feast if feast.startswith(("il ", "l'", "la ")) else f"il giorno di {feast}"
                self.add("ts_festa", (comp, d, pid), f"Quale di questi giocatori ha segnato {IN_COMP[comp]} {label} del {d.year}?",
                         t.pname(pid), [t.pname(p) for p in pool], year=d.year, fame=t.fame(pid), comp=comp, archetype=1,
                         entities=[f"comp:{comp}", t.pid(pid)], sources=[t.src_game(g)],
                         script=f"Il {date_it(d)} {t.pname(pid)} ha segnato in {t.label(g)} ({t.ctx(g)}).")

    # ------------------------------------------------------------------ T10 first goal, T11 hat-tricks
    def firsts_and_hat_tricks(self) -> None:
        t = self.t
        for pid, lst in self.pgoals.items():
            p = t.players.get(pid)
            if not p or not p["dob"] or not t.is_notable(pid):
                continue
            for comp in QUIZ_COMPS:
                mine = sorted(x for x in lst if x[1] == comp)
                if not mine:
                    continue
                d, _c, season, gid, club, n = mine[0]
                g = self.G[gid]
                opp = g["away"] if club == g["home"] else g["home"]
                opps = [t.club(o) for o in self.player_opps[(pid, comp, season)] if o != opp]
                young = p["dob"].year >= 1997
                if young and self.clean_history(pid, comp, d):
                    note = " (qualificazioni escluse)" if comp == "CL" else ""
                    self.add("ts_primo_gol", (pid, comp), f"Contro quale squadra {t.pname(pid)} ha segnato il suo primo gol {IN_COMP[comp]}{note}?",
                             t.club(opp), opps, year=d.year, fame=t.fame(pid), comp=comp, archetype=3,
                             entities=[f"comp:{comp}", t.pid(pid), t.cid(opp)], sources=[t.src_game(g), t.src_player(pid)],
                             script=f"Il primo gol di {t.pname(pid)} {IN_COMP[comp]} è arrivato il {date_it(d)} in {t.label(g)} ({t.ctx(g)}).")
                big = [x for x in mine if x[5] >= 3]
                if len(big) == 1 and self.clean_history(pid, comp, END):
                    d, _c, season, gid, club, n = big[0]
                    g = self.G[gid]
                    opp = g["away"] if club == g["home"] else g["home"]
                    opps = [t.club(o) for o in self.player_opps[(pid, comp, season)] if o != opp]
                    what = {3: "la sua unica tripletta", 4: "un poker", 5: "cinque gol in una partita"}.get(n, f"{n} gol in una partita")
                    scope = "" if young else " tra il 2012/13 e il 2025/26"
                    self.add("ts_tripletta", (pid, comp), f"Contro quale squadra {t.pname(pid)} ha segnato {what} {IN_COMP[comp]}{scope}?",
                             t.club(opp), opps, year=d.year, fame=t.fame(pid), comp=comp, archetype=1,
                             entities=[f"comp:{comp}", t.pid(pid), t.cid(opp)], sources=[t.src_game(g)],
                             script=f"{t.pname(pid)} ha segnato {n} gol in {t.label(g)} ({t.ctx(g)}, {date_it(d)}).")

    # ------------------------------------------------------------------ T12 same surname on opposite sides
    def same_surname(self) -> None:
        t = self.t
        rows = t.q("""select a.gid, a.pid, b.pid, pa.last_name from lu a join lu b on a.gid = b.gid and a.pid < b.pid and a.club <> b.club
                      join players pa on pa.player_id = a.pid join players pb on pb.player_id = b.pid
                      where a.starter and b.starter and pa.last_name is not null and length(pa.last_name) >= 4
                        and lower(pa.last_name) = lower(pb.last_name) and pa.first_name is not null and pb.first_name is not null""")
        best = {}
        for gid, a, b, last in rows:
            a, b = int(a), int(b)
            if not (t.is_notable(a) and t.is_notable(b)):
                continue
            g = self.G[gid]
            if (a, b) not in best or weight(t, g) > weight(t, best[(a, b)][0]):
                best[(a, b)] = (g, last)
        for (a, b), (g, last) in best.items():
            ds = sorted({t.surname(p) for p in self.starters(g["gid"]) if p not in (a, b) and t.surname(p).lower() != last.lower()})
            self.add("ts_omonimi", (a, b), f"In {t.label(g)} ({t.ctx(g)}) due avversari, entrambi titolari, portavano lo stesso cognome: quale?",
                     last, ds, year=g["date"].year, fame=max(t.fame(a), t.fame(b)), comp=g["comp"], archetype=4,
                     entities=[f"comp:{g['comp']}", t.pid(a), t.pid(b)], sources=[t.src_game(g)],
                     script=f"In campo dal primo minuto, uno contro l'altro, c'erano {t.pname(a)} e {t.pname(b)} ({date_it(g['date'])}).")

    # ------------------------------------------------------------------ T13 goals for two clubs in one league season
    def two_clubs(self) -> None:
        t = self.t
        by = defaultdict(lambda: defaultdict(set))
        for pid, lst in self.pgoals.items():
            for d, comp, season, gid, club, n in lst:
                if comp in L5:
                    by[(comp, season)][pid].add(club)
        for (comp, season), players in by.items():
            single = sorted((p for p, cs in players.items() if len(cs) == 1 and t.is_notable(p)), key=lambda p: -t.fame(p))[:25]
            for pid, cs in players.items():
                if len(cs) != 2 or not t.is_notable(pid) or not all(t.valid_seasons(comp, c, "goal").get(season) for c in cs):
                    continue
                a, b = sorted(cs, key=lambda c: min(x[0] for x in self.pgoals[pid] if x[4] == c and x[1] == comp and x[2] == season))
                self.add("ts_due_maglie", (comp, season, pid), f"Quale di questi giocatori ha segnato con due squadre diverse nella {COMP_IT[comp]} {season_label(season)}?",
                         t.pname(pid), [t.pname(p) for p in single], year=season, fame=t.fame(pid), comp=comp, archetype=5,
                         entities=[f"comp:{comp}", t.pid(pid), t.cid(a), t.cid(b)], sources=[t.src_player(pid), SRC_DATASET],
                         script=f"Nella {COMP_IT[comp]} {season_label(season)} {t.pname(pid)} ha segnato prima {t.con(a)} e poi {t.con(b)}.")

    # ------------------------------------------------------------------ T16 a home game in someone else's stadium
    def odd_stadium(self) -> None:
        t = self.t
        use = defaultdict(Counter)
        season_use = defaultdict(Counter)
        last_season = {}
        for g in self.G.values():
            if g["stadium"] and not t.is_nation(g["home"]):
                use[g["home"]][g["stadium"]] += 1
                season_use[(g["home"], g["season"])][g["stadium"]] += 1
                last_season[g["home"]] = max(last_season.get(g["home"], 0), g["season"])
        usual = {c: cnt.most_common(1)[0][0] for c, cnt in use.items()}
        usual_of_others = defaultdict(set)
        for c, st in usual.items():
            usual_of_others[st].add(c)
        league_stadiums = defaultdict(set)
        for c, st in usual.items():
            league_stadiums[t.club_league.get(c)].add(st)
        for g in self.G.values():
            club, st = g["home"], g["stadium"]
            if not st or g["comp"] not in (*QUIZ_COMPS, "EL") or t.is_nation(club) or not (club in t.sa_clubs or club in t.big):
                continue
            rnd = (g["round"] or "").lower()
            if "final" in rnd and "semi" not in rnd and "quarter" not in rnd:
                continue  # finals are played on neutral ground
            su = season_use[(club, g["season"])]
            home_st, n_home = su.most_common(1)[0]
            if st == home_st or use[club][st] > 3 or n_home < 8:
                continue
            real_other = bool(usual_of_others.get(st, set()) - {club})
            if not real_other and g["season"] >= last_season[club]:
                continue
            ds = [home_st] + sorted(s for s in league_stadiums[t.club_league.get(club)] if s not in (st, home_st))[:12]
            o = [home_st] + random.Random(g["gid"]).sample(ds[1:], min(2, len(ds) - 1))
            self.add("ts_stadio", g["gid"], f"In quale stadio {t.il(club)} ha giocato in casa {t.label(g)} del {date_it(g['date'])} ({t.ctx(g)})?",
                     st, o, year=g["date"].year, fame=60, comp=g["comp"], archetype=6, entities=[f"comp:{g['comp']}", t.cid(club)],
                     sources=[t.src_game(g)],
                     script=f"Quel giorno {t.il(club)} non ha giocato nel suo stadio abituale ({home_st}) ma a: {st}.")

    # ------------------------------------------------------------------ T18 never scored
    def never_scored(self) -> None:
        t = self.t
        for comp, min_apps in (("CL", 8), ("IT1", 40)):
            scorers = sorted({p for p, lst in self.pgoals.items() if any(x[1] == comp for x in lst) and t.is_notable(p)
                              and t.players[p]["dob"] and t.players[p]["dob"].year >= 1993}, key=lambda p: -t.fame(p))[:120]
            for (pid, c), n in self.pres_count.items():
                p = t.players.get(pid)
                if c != comp or n < min_apps or not p or not p["dob"] or p["dob"].year < 1997 or p["line"] == "Goalkeeper" or not t.is_notable(pid):
                    continue
                if any(x[1] == comp for x in self.pgoals.get(pid, [])) or not self.clean_history(pid, comp, END):
                    continue
                r = random.Random(pid)
                note = "Champions League (qualificazioni escluse" if comp == "CL" else "Serie A ("
                self.add("ts_mai_gol", (pid, comp), f"Quale di questi giocatori non ha mai segnato in {note}{', ' if comp == 'CL' else ''}dati al 6 luglio 2026)?",
                         t.pname(pid), [t.pname(q) for q in r.sample(scorers, min(12, len(scorers)))], year=2026, fame=t.fame(pid), comp=comp,
                         archetype=5, entities=[f"comp:{comp}", t.pid(pid)], sources=[t.src_player(pid), SRC_DATASET], active=[2026],
                         script=f"{t.pname(pid)} ha {n} presenze {IN_COMP[comp]} senza alcun gol (dati al 6 luglio 2026).")

    # ------------------------------------------------------------------ T19 referees of the big nights
    def referees(self) -> None:
        t = self.t
        refs = defaultdict(set)
        for g in self.G.values():
            if g["referee"]:
                refs[(g["comp"], g["season"])].add(g["referee"])
        cands = []
        for g in self.G.values():
            rnd = (g["round"] or "").lower()
            final = "final" in rnd and "semi" not in rnd and "quarter" not in rnd
            big = g["home"] in t.big and g["away"] in t.big and g["comp"] in ("IT1", "CL")
            if g["referee"] and (final or (big and "semi" in rnd) or (big and g["comp"] == "IT1")):
                cands.append(g)
        cands.sort(key=lambda g: -weight(t, g))
        for g in cands[:400]:
            pool = set(refs[(g["comp"], g["season"])])
            if len(pool) < 6:
                pool |= refs[("CL", g["season"])] if g["comp"] != "IT1" else set()
            self.add("ts_arbitro", g["gid"], f"Chi ha arbitrato {t.label(g)} ({t.ctx(g)})?", g["referee"], sorted(pool - {g["referee"]}),
                     year=g["date"].year, fame=weight(t, g), comp=g["comp"], archetype=2, entities=[f"comp:{g['comp']}", t.rid(g["referee"])],
                     sources=[t.src_game(g)], script=f"{t.label(g)} ({t.ctx(g)}, {date_it(g['date'])}) è stata diretta da {g['referee']}.")

    # ------------------------------------------------------------------ T22 three scorers off the bench
    def bench_scorers(self) -> None:
        t = self.t
        rows = t.q("""select e.gid, count(distinct e.pid) from goal e where not e.own and exists(select 1 from sub s where s.gid = e.gid and s.pin = e.pid)
                      group by 1""")
        n_sub = {gid: int(n) for gid, n in rows}
        by_season = defaultdict(list)
        for g in self.G.values():
            if g["comp"] in QUIZ_COMPS and g["ev_ok"] and g["gid"] in self.lu_ok and g["fh"] + g["fa"] >= 3:
                by_season[(g["comp"], g["season"])].append(g)
        for (comp, season), games in by_season.items():
            for g in games:
                if n_sub.get(g["gid"], 0) < 3:
                    continue
                others = [t.label(x) for x in games if n_sub.get(x["gid"], 0) < 3 and x["fh"] + x["fa"] >= 4]
                names = [t.pname(x[2]) for x in self.goals[g["gid"]] if not x[3]]
                self.add("ts_panchinari", g["gid"], f"In quale di queste partite {OF_COMP[comp]} {season_label(season)} hanno segnato tre giocatori entrati dalla panchina?",
                         t.label(g), others, year=season, fame=weight(t, g), comp=comp, archetype=2, entities=[f"comp:{comp}", t.cid(g["home"]), t.cid(g["away"])],
                         sources=[t.src_game(g)],
                         script=f"{t.label(g)} ({t.ctx(g)}, {date_it(g['date'])}): tre dei marcatori ({', '.join(dict.fromkeys(names))}) erano partiti dalla panchina.")

    def run(self) -> list[dict]:
        for fn in (self.birthday_goals, self.unique_weekday, self.same_birthdate, self.managers, self.goal_and_own_goal, self.quick_red,
                   self.comebacks, self.short_managers, self.feast_goals, self.firsts_and_hat_tricks, self.same_surname, self.two_clubs,
                   self.odd_stadium, self.never_scored, self.referees, self.bench_scorers):
            fn()
        return self.out


def generate(t: TM) -> dict[str, list[dict]]:
    return {"tiro_secco": Quiz(t).run()}

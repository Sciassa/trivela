"""Testa a Testa (SPEC §4.11): a duel on one chain of «more or less?» comparisons on one statistic, inside one league.

Every chain holds nine known players of similar fame who played in that league: eight comparisons, taken in turns by
the two players. The chain gets harder step by step: the first two values are far apart, the last ones close (never
tied: at least 10% apart; 2 cm for height, 2 years for age). It goes both up and down, never three steps the same way,
so that «always MORE» is not a strategy. Statistics on games (goals, appearances) use only the league's complete
window, declared in the title.
"""

from __future__ import annotations

import datetime as dt
import random
from collections import defaultdict

from .gen_lists import scope
from .tm_core import IN_COMP, L5, SNAPSHOT, SRC_DATASET, TM, base, fee_label

CHAIN = 9  # the first player is shown with his value, then eight comparisons
# how far apart two neighbours are at each step, from easy to hard: (at least, less than) the share of the larger value
STEPS = [(0.45, 9.0), (0.35, 0.6), (0.28, 0.45), (0.22, 0.36), (0.17, 0.3), (0.13, 0.24), (0.11, 0.19), (0.1, 0.15)]
# the same steps in centimetres (height) and in years (age)
STEPS_CM = [(10, 99), (8, 14), (6, 11), (5, 9), (4, 7), (3, 6), (2, 5), (2, 4)]
STEPS_YEARS = [(8, 99), (6, 10), (5, 8), (4, 7), (3, 6), (2, 5), (2, 4), (2, 3)]
CHAINS_PER_STAT = 40
MAX_CHAINS_PER_PLAYER = 4
MIN_FAME = 75


def gen_id(stat: str, comp: str) -> str:
    return f"testa_{stat}" if comp == "IT1" else f"testa_{stat}@estero"


class Testa:
    def __init__(self, t: TM):
        self.t = t
        self.out: list[dict] = []
        comps = ",".join(f"'{c}'" for c in L5)
        self.goals_s = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))  # comp -> pid -> season -> goals
        for comp, pid, season, n in t.q(f"select gm.comp, pg.pid, gm.season, sum(pg.goals) from pg join gm using(gid) where gm.comp in ({comps}) group by 1, 2, 3"):
            self.goals_s[comp][int(pid)][int(season)] += int(n)
        self.apps_s = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
        for comp, pid, season, n in t.q(f"select gm.comp, p.pid, gm.season, count(distinct p.gid) from pres p join gm using(gid) where gm.comp in ({comps}) group by 1, 2, 3"):
            self.apps_s[comp][int(pid)][int(season)] += int(n)
        self.played = defaultdict(set)  # comp -> players with at least one appearance there
        for comp, by in self.apps_s.items():
            self.played[comp] = set(by)
        self.top_fee: dict[int, float] = {}
        for pid, fee in t.q("select player_id, max(transfer_fee) from transfers where transfer_fee > 0 and transfer_date <= date '2026-07-06' group by 1"):
            self.top_fee[int(pid)] = float(fee)
        self.snapshot = dt.date.fromisoformat(SNAPSHOT)

    # ------------------------------------------------------------------ statistics: (title, definition, unit, values, label, gap)
    def stats(self, comp: str):
        t = self.t
        known = {p for p in self.played[comp] if t.is_notable(p) and t.fame(p) >= MIN_FAME}
        lg = IN_COMP[comp]
        rel = "rel"
        wg = t.window(comp, None, "goal")
        if wg:
            v = {p: sum(n for s, n in self.goals_s[comp][p].items() if wg[0] <= s <= wg[1]) for p in known}
            yield ("gol", f"Gol {lg} ({scope(wg)})", f"Gol segnati {lg}, rigori compresi, autogol esclusi; stagioni con tutti i gol registrati. Dati Transfermarkt al 6 luglio 2026.",
                   "gol", {p: n for p, n in v.items() if n >= 5}, lambda n: f"{n} gol", rel)
        wp = t.window(comp, None, "pres")
        if wp:
            v = {p: sum(n for s, n in self.apps_s[comp][p].items() if wp[0] <= s <= wp[1]) for p in known}
            yield ("presenze", f"Presenze {lg} ({scope(wp)})", f"Partite giocate {lg}, anche da subentrato; stagioni con tutte le presenze registrate. Dati Transfermarkt al 6 luglio 2026.",
                   "presenze", {p: n for p, n in v.items() if n >= 20}, lambda n: f"{n} presenze", rel)
        h = {p: t.players[p]["height"] for p in known if t.players[p]["height"]}
        yield ("altezza", f"Altezza dei giocatori scesi in campo {lg}", "Altezza in centimetri secondo Transfermarkt (dati al 6 luglio 2026).",
               "cm", h, lambda n: f"{n} cm", "cm")
        mv = {p: t.players[p]["mv"] for p in known if t.players[p]["mv"] >= 1_000_000}
        yield ("valore", f"Valore di mercato più alto in carriera, giocatori scesi in campo {lg}",
               "Il valore più alto mai stimato da Transfermarkt per il giocatore (dati al 6 luglio 2026).", "€", mv, fee_label, rel)
        fee = {p: self.top_fee[p] for p in known if self.top_fee.get(p, 0) >= 1_000_000}
        yield ("cartellino", f"Trasferimento più caro della carriera, giocatori scesi in campo {lg}",
               "La cifra più alta pagata per il suo cartellino, secondo Transfermarkt (trasferimenti fino al 6 luglio 2026).", "€", fee, fee_label, rel)
        age = {p: (self.snapshot - t.players[p]["dob"]).days for p in known if t.players[p]["dob"]}
        yield ("eta", f"Età al 6 luglio 2026, giocatori scesi in campo {lg}", "Età in anni compiuti al 6 luglio 2026 (data di nascita Transfermarkt). PIÙ vuol dire più anziano.",
               "anni", age, lambda n: f"{n // 365} anni", "years")

    # ------------------------------------------------------------------ chains
    @staticmethod
    def gap_ok(kind: str, step: int, a: float, b: float) -> bool:
        """Step `step` (0 = the first comparison) wants two values this far apart: closer and closer along the chain."""
        if kind == "cm":
            lo, hi = STEPS_CM[step]
            return lo <= abs(a - b) < hi
        if kind == "years":
            lo, hi = STEPS_YEARS[step]
            return lo * 365 <= abs(a - b) < hi * 365
        lo, hi = STEPS[step]
        gap = abs(a - b) / max(a, b)
        return lo <= gap < hi

    def chain(self, values: dict[int, float], kind: str, r: random.Random, used: dict[int, int]) -> list[int] | None:
        t = self.t
        free = [p for p in values if used[p] < MAX_CHAINS_PER_PLAYER]
        if len(free) < CHAIN * 3:
            return None
        start = r.choice(free)
        out, dirs = [start], []
        for _ in range(CHAIN - 1):
            cur = out[-1]
            # never three steps the same way, and both ways at least once over the chain
            want = r.choice((1, -1))
            if len(dirs) >= 2 and dirs[-1] == dirs[-2]:
                want = -dirs[-1]
            if len(dirs) == CHAIN - 2 and len(set(dirs)) == 1:
                want = -dirs[0]
            step = len(dirs)
            cands = [p for p in free if p not in out and self.gap_ok(kind, step, values[p], values[cur]) and (values[p] > values[cur]) == (want > 0)]
            if not cands:
                return None
            cands = t.near_in_fame(t.fame(start), cands)[:6]
            nxt = r.choice(cands)
            out.append(nxt)
            dirs.append(want)
        return out

    def run(self) -> list[dict]:
        t = self.t
        for comp in L5:
            for stat, title, definition, unit, values, label, kind in self.stats(comp):
                used: dict[int, int] = defaultdict(int)
                made, tries = 0, 0
                r = random.Random(f"testa-{comp}-{stat}")
                while made < CHAINS_PER_STAT and tries < CHAINS_PER_STAT * 20:
                    tries += 1
                    ch = self.chain(values, kind, r, used)
                    if not ch:
                        continue
                    for p in ch:
                        used[p] += 1
                    made += 1
                    chain = [{"id": t.pid(p), "name": t.pname(p), "value": values[p], "label": label(values[p])} for p in ch]
                    fame = round(sum(t.fame(p) for p in ch) / len(ch))
                    it = base(gen_id(stat, comp), (comp, stat, made), year=2012, year_max=2026, fame=fame,
                              entities=[f"comp:{comp}", *(t.pid(p) for p in ch)], sources=[SRC_DATASET],
                              script=f"{title}: " + " · ".join(f"{c['name']} {c['label']}" for c in chain) + ".")
                    it.update({"title": title, "definition": definition, "unit": unit, "chain": chain})
                    self.out.append(it)
        return self.out


def generate(t: TM) -> dict[str, list[dict]]:
    return {"testa_a_testa": Testa(t).run()}

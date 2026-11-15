"""Tiro Secco, word games on surnames (SPEC §4.1): what a surname means, crossed with real statistics.

"Which of these players, who all played in Serie A, has an animal in his surname?", "which of these players with a
trade for a surname scored the most goals in the Bundesliga?". The meanings come from the hand-written word lists in
`lexicon` (no football fact comes from there); presences and goals are computed on the verified facts layer, with the
same completeness rules as every other question. Every option is a real, notable player: nothing is made up.
"""

from __future__ import annotations

import random
import re
from collections import defaultdict

from . import lexicon
from .gen_quiz import END, Quiz
from .tm_core import IN_COMP, L5, SRC_DATASET, norm, season_label

COMPS = (*L5, "CL")
IT = lexicon.IT

# category -> (what one player does, what several players do, short label of the category)
TEXT = {
    "animali": ("porta nel cognome il nome di un animale", "portano nel cognome il nome di un animale", "un animale"),
    "storia": ("porta il cognome di un grande personaggio della storia, della scienza o dell'arte",
               "portano il cognome di un grande personaggio della storia, della scienza o dell'arte", "un personaggio storico"),
    "dittatori": ("porta il cognome di un famoso dittatore", "portano il cognome di un famoso dittatore", "un dittatore"),
    "citta": ("porta nel cognome il nome di una città", "portano nel cognome il nome di una città", "una città"),
    "colori": ("porta nel cognome il nome di un colore", "portano nel cognome il nome di un colore", "un colore"),
    "mestieri": ("porta nel cognome il nome di un mestiere", "portano nel cognome il nome di un mestiere", "un mestiere"),
    "cibo": ("porta nel cognome il nome di qualcosa che si mangia", "portano nel cognome il nome di qualcosa che si mangia", "qualcosa che si mangia"),
    "piante": ("porta nel cognome il nome di un albero, di un fiore o di una pianta", "portano nel cognome il nome di un albero, di un fiore o di una pianta", "una pianta"),
    "nobili": ("porta nel cognome un titolo nobiliare", "portano nel cognome un titolo nobiliare", "un titolo nobiliare"),
    "chiesa": ("porta nel cognome una parola di chiesa", "portano nel cognome una parola di chiesa", "una parola di chiesa"),
    "calendario": ("porta nel cognome un mese, una stagione o una festa", "portano nel cognome un mese, una stagione o una festa", "un mese, una stagione o una festa"),
}
THRESHOLDS = (100, 50, 30, 20, 10, 5)


def surname_words(p: dict) -> list[str]:
    """Lower-case words of the surname, accents kept. Stage names made of given names ("Bruno Henrique") only count their last word."""
    raw = (p["last"] or p["name"] or "").lower()
    words = [w for w in re.split(r"[\s\-]+", raw) if w]
    return words if p["first"] or len(words) == 1 else words[-1:]


class Nomi(Quiz):
    def __init__(self, t):
        super().__init__(t)
        cmp = ",".join(f"'{c}'" for c in COMPS)
        self.apps = defaultdict(int)  # (pid, comp, season) -> presences
        for pid, comp, season, n in t.q(f"select p.pid, gm.comp, gm.season, count(*) from pres p join gm using(gid) where gm.comp in ({cmp}) group by 1, 2, 3"):
            self.apps[(int(pid), comp, int(season))] = int(n)
        self.windows = {comp: t.window(comp, None, "pres") for comp in COMPS}
        self.span = {}  # (pid, comp) -> (first season, last season, presences inside the complete window)
        for (pid, comp, season), n in self.apps.items():
            w = self.windows[comp]
            a, b, tot = self.span.get((pid, comp), (season, season, 0))
            self.span[(pid, comp)] = (min(a, season), max(b, season), tot + (n if w and w[0] <= season <= w[1] else 0))
        self.goals_in = defaultdict(int)  # (pid, comp) -> goals
        for pid, lst in self.pgoals.items():
            for d, comp, season, gid, club, n in lst:
                if comp in COMPS:
                    self.goals_in[(pid, comp)] += n
        # owners: category -> pid -> (word as written, meaning, language or note); one profile per name
        self.cats = defaultdict(set)  # pid -> every category his surname can be read as
        self.word = {}  # (pid, cat) -> (word, meaning, note)
        best: dict[str, int] = {}
        for pid, p in t.players.items():
            if not t.is_notable(pid) or not any((pid, c) in self.span for c in COMPS):
                continue
            key = norm(p["name"])
            if key in best and t.apps.get(best[key], 0) >= t.apps.get(pid, 0):
                continue
            best[key] = pid
        for pid in best.values():
            p = t.players[pid]
            words = surname_words(p)
            joined = " ".join(words)
            shown = {w.lower(): w for w in re.split(r"[\s\-]+", p["last"] or p["name"])}
            for cat, entries in lexicon.CATEGORIES.items():
                for w, (meaning, note) in entries.items():
                    if w in words or (" " in w and f" {w} " in f" {joined} "):
                        real = "dittatori" if cat == "storia" and note == "dittatore" else cat
                        self.word.setdefault((pid, real), (" ".join(shown.get(x, x.capitalize()) for x in w.split()), meaning, note))
                        self.cats[pid].add(real)
                        if real == "dittatori":
                            self.cats[pid].add("storia")
                        self.cats[pid] |= lexicon.ALSO.get(w, set())
        self.owners = defaultdict(list)  # (cat, comp) -> pids who played there, most famous first
        for (pid, cat) in self.word:
            for comp in COMPS:
                if (pid, comp) in self.span:
                    self.owners[(cat, comp)].append(pid)
        for k in self.owners:
            self.owners[k].sort(key=lambda p: (-t.fame(p), p))

    # ------------------------------------------------------------------ helpers
    def explain(self, pid: int, cat: str) -> str:
        w, meaning, note = self.word[(pid, cat)]
        name = self.t.pname(pid)
        if cat in ("storia", "dittatori"):
            return f"{name}: «{w}» come {meaning}"
        if cat == "citta":
            return f"{name}: «{w}» come {meaning} ({note})"
        if meaning.lower() == w.lower():
            return f"{name}: «{w}», in {note}"
        return f"{name}: «{w}» significa «{meaning}» in {note}"

    def label(self, pid: int, cat: str) -> str:
        w = self.word[(pid, cat)][0]
        return f"{self.t.pname(pid)} («{w}»: {TEXT[cat][2]})"

    def distinct(self, pids: list[int], cat: str | None = None) -> bool:
        """No two options with the same surname word (two Castros would give the game away)."""
        t = self.t
        seen = set()
        for p in pids:
            ws = {norm(self.word[(p, c)][0]) for c in ([cat] if cat else [c for c in TEXT if (p, c) in self.word])} | {norm(t.surname(p))}
            if ws & seen:
                return False
            seen |= ws
        return True

    def put(self, gen: str, key, question: str, correct: int, wrong: list[int], *, comp: str, year: int, script: str) -> bool:
        t = self.t
        ok = self.add(gen, key, question, t.pname(correct), [t.pname(p) for p in wrong], year=year, fame=t.fame(correct), comp=comp, archetype=6,
                      entities=[f"comp:{comp}", *(t.pid(p) for p in [correct, *wrong])], sources=[SRC_DATASET, t.src_player(correct)], script=script)
        if ok:
            self.out[-1]["tag"] = "nomi"
        return ok

    def last_year(self, pids: list[int], comp: str) -> int:
        return min(self.span[(p, comp)][1] for p in pids)

    def first_year(self, pids: list[int], comp: str) -> int:
        return min(self.span[(p, comp)][0] for p in pids)

    def exact_goals(self, pid: int, comp: str) -> bool:
        return self.clean_history(pid, comp, END)

    # ------------------------------------------------------------------ A: whose surname is it?
    def who(self, per_owner: int = 2, cap: int = 16) -> None:
        """One player of the category among three whose surnames mean something else; and the other way round, the odd one out."""
        for cat in TEXT:
            for comp in COMPS:
                own = self.owners.get((cat, comp), [])
                if not own:
                    continue
                # players of other categories who cannot be read as this one
                others = defaultdict(list)
                for (c2, cc), pids in self.owners.items():
                    if cc == comp and c2 != cat and c2 != "dittatori" and not (cat == "dittatori" and c2 != "storia"):
                        others[c2] += [p for p in pids if cat not in self.cats[p]]
                r = random.Random(f"nomi-{cat}-{comp}")
                made = 0
                for pid in own:
                    for k in range(per_owner):
                        if made >= cap:
                            break
                        if cat == "dittatori":  # against other great names of history: harder than against a baker
                            pool = [p for p in others.get("storia", [])]
                            if len(pool) < 3:
                                continue
                            wrong = r.sample(pool[:14], 3)
                        else:
                            cs = [c for c in others if others[c]]
                            if len(cs) < 3:
                                continue
                            wrong = [r.choice(others[c][:10]) for c in r.sample(cs, 3)]
                        if len(set(wrong)) < 3 or not self.distinct([pid, *wrong]):
                            continue
                        rest = "; ".join(self.label(p, next(c for c in TEXT if (p, c) in self.word and c != "dittatori" or (p, c) in self.word and cat == "dittatori" and c == "storia")) for p in wrong)
                        q = f"Quale di questi giocatori, che hanno tutti giocato {IN_COMP[comp]}, {TEXT[cat][0]}?"
                        made += self.put(f"nomi_{cat}", ("chi", pid, comp, k), q, pid, wrong, comp=comp, year=self.last_year([pid, *wrong], comp),
                                         script=f"{self.explain(pid, cat)}. Gli altri: {rest}.")
                # the odd one out
                intruders = [p for c in others for p in others[c][:8]]
                made = 0
                for k in range(min(cap // 2, len(own) * 2)):
                    if len(own) < 3 or not intruders:
                        break
                    trio = r.sample(own[:12], 3)
                    x = r.choice(intruders)
                    if not self.distinct([x, *trio]) or not self.distinct(trio, cat):
                        continue
                    xc = next(c for c in TEXT if (x, c) in self.word and c != "dittatori")
                    q = f"Tre di questi giocatori, che hanno tutti giocato {IN_COMP[comp]}, {TEXT[cat][1]}. Chi è l'intruso?"
                    made += self.put(f"nomi_{cat}", ("intruso", tuple(sorted(trio)), x, comp), q, x, trio, comp=comp, year=self.last_year([x, *trio], comp),
                                     script=f"L'intruso è {self.label(x, xc)}. " + "; ".join(self.explain(p, cat) for p in trio) + ".")

    # ------------------------------------------------------------------ B, C: goals
    def by_goals(self, cap: int = 6) -> None:
        t = self.t
        for cat in TEXT:
            for comp in COMPS:
                own = [p for p in self.owners.get((cat, comp), []) if self.exact_goals(p, comp)]
                if len(own) < 4:
                    continue
                g = {p: self.goals_in[(p, comp)] for p in own}
                ranked = sorted(own, key=lambda p: (-g[p], p))
                r = random.Random(f"nomi-gol-{cat}-{comp}")
                made = 0
                for i, top in enumerate(ranked):
                    below = [p for p in ranked[i + 1:] if g[p] <= g[top] - 2]
                    if g[top] < 3 or len(below) < 3 or made >= cap:
                        continue
                    wrong = below[:3] if made % 2 == 0 else r.sample(below[:8], 3)
                    if not self.distinct([top, *wrong], cat):
                        continue
                    q = f"Quale di questi giocatori, che {TEXT[cat][1].replace('portano', 'portano tutti', 1)}, ha segnato più gol {IN_COMP[comp]} (stagioni 2012/13–2025/26)?"
                    tot = "; ".join(f"{t.pname(p)} {g[p]}" for p in [top, *sorted(wrong, key=lambda p: -g[p])])
                    made += self.put("nomi_gol", (cat, comp, top, tuple(sorted(wrong))), q, top, wrong, comp=comp, year=self.first_year([top, *wrong], comp),
                                     script=f"Gol {IN_COMP[comp]} dal 2012/13 al 2025/26: {tot}. " + "; ".join(self.explain(p, cat) for p in [top, *wrong]) + ".")
                # the threshold, as in "which animal scored at least 20 goals in Serie A?"
                made = 0
                for top in ranked:
                    n = next((x for x in THRESHOLDS if g[top] >= x), None)
                    if n is None or made >= cap:
                        continue
                    low = [p for p in ranked if g[p] <= n // 4 and p != top]
                    if len(low) < 3:
                        continue
                    wrong = r.sample(low[:10], 3)
                    if not self.distinct([top, *wrong], cat):
                        continue
                    q = f"Quale di questi giocatori, che {TEXT[cat][1].replace('portano', 'portano tutti', 1)}, ha segnato almeno {n} gol {IN_COMP[comp]} (stagioni 2012/13–2025/26)?"
                    tot = "; ".join(f"{t.pname(p)} {g[p]}" for p in sorted(wrong, key=lambda p: -g[p]))
                    made += self.put("nomi_soglia", (cat, comp, top, n), q, top, wrong, comp=comp, year=self.first_year([top, *wrong], comp),
                                     script=f"{t.pname(top)} ha segnato {g[top]} gol {IN_COMP[comp]} dal 2012/13 al 2025/26. Gli altri: {tot}. "
                                            + "; ".join(self.explain(p, cat) for p in [top, *wrong]) + ".")

    # ------------------------------------------------------------------ D, E: presences
    def by_presences(self, cap: int = 6) -> None:
        t = self.t
        for cat in TEXT:
            for comp in COMPS:
                w = self.windows[comp]
                if not w:
                    continue
                span = f"tra il {season_label(w[0])} e il {season_label(w[1])}"
                own = [p for p in self.owners.get((cat, comp), []) if self.span[(p, comp)][2] > 0 and w[0] <= self.span[(p, comp)][0] and self.span[(p, comp)][1] <= w[1]]
                a = {p: self.span[(p, comp)][2] for p in own}
                ranked = sorted(own, key=lambda p: (-a[p], p))
                r = random.Random(f"nomi-pres-{cat}-{comp}")
                made = 0
                for i, top in enumerate(ranked):
                    below = [p for p in ranked[i + 1:] if a[p] <= a[top] - 10]
                    if a[top] < 30 or len(below) < 3 or made >= cap:
                        continue
                    wrong = below[:3] if made % 2 == 0 else r.sample(below[:8], 3)
                    if not self.distinct([top, *wrong], cat):
                        continue
                    q = f"Quale di questi giocatori, che {TEXT[cat][1].replace('portano', 'portano tutti', 1)}, ha più presenze {IN_COMP[comp]} ({span})?"
                    tot = "; ".join(f"{t.pname(p)} {a[p]}" for p in [top, *sorted(wrong, key=lambda p: -a[p])])
                    made += self.put("nomi_presenze", (cat, comp, top, tuple(sorted(wrong))), q, top, wrong, comp=comp, year=w[0],
                                     script=f"Presenze {IN_COMP[comp]} {span}: {tot}. " + "; ".join(self.explain(p, cat) for p in [top, *wrong]) + ".")
                if comp == "CL":
                    continue
                # who played in this league at all? The others, notable elsewhere, never did inside the complete window
                everywhere = sorted({p for (c, cc), pids in self.owners.items() if c == cat for p in pids}, key=lambda p: (-t.fame(p), p))
                never = [p for p in everywhere if not any((p, comp, s) in self.apps for s in range(2012, 2027))]
                made = 0
                for top in ranked:
                    if a[top] < 20 or len(never) < 3 or made >= cap:
                        continue
                    wrong = r.sample(never[:12], 3)
                    if not self.distinct([top, *wrong], cat):
                        continue
                    q = f"Quale di questi giocatori, che {TEXT[cat][1].replace('portano', 'portano tutti', 1)}, ha giocato {IN_COMP[comp]} ({span})?"
                    made += self.put("nomi_campionato", (cat, comp, top, tuple(sorted(wrong))), q, top, wrong, comp=comp, year=w[0],
                                     script=f"{t.pname(top)}: {a[top]} presenze {IN_COMP[comp]} {span}. Gli altri tre non ci hanno mai giocato in quelle stagioni. "
                                            + "; ".join(self.explain(p, cat) for p in [top, *wrong]) + ".")

    def run(self) -> list[dict]:
        self.who()
        self.by_goals()
        self.by_presences()
        return self.out


def generate(t) -> dict[str, list[dict]]:
    return {"tiro_secco": Nomi(t).run()}

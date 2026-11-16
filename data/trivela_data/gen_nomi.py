"""Tiro Secco, word games on surnames (SPEC §4.1).

The options are four surnames of one family of words: «Quale di questi cognomi (tutti nomi di animali) appartiene a un
giocatore che ha giocato in Serie A?» Gatti · Cani · Topi · Salmoni. One is the surname of a real, notable player; the
other three are words of the same family that the dataset proves no player of that competition ever had (every row of
the competition is checked: presences, appearance rows, line-ups, goals). The same with goals: «… che ha segnato almeno
20 gol in Serie A?», where a wrong option may also be a real surname whose bearers scored far fewer.
The meanings come from the hand-written word lists in `lexicon`; no football fact comes from there.
"""

from __future__ import annotations

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

# "Quale di questi cognomi (tutti nomi di animali in portoghese) ..."
PHRASE = {
    "animali": "tutti nomi di animali",
    "storia": "tutti cognomi di grandi personaggi della storia, della scienza o dell'arte",
    "dittatori": "tutti cognomi di dittatori",
    "citta": "tutti nomi di città",
    "colori": "tutti nomi di colori",
    "mestieri": "tutti nomi di mestieri",
    "cibo": "tutti nomi di cose da mangiare",
    "piante": "tutti nomi di alberi, fiori o piante",
    "nobili": "tutti titoli nobiliari",
    "chiesa": "tutte parole di chiesa",
    "calendario": "tutti mesi, giorni, stagioni o feste",
}
# families whose words belong to a language (the wrong options come from the same language)
BY_LANGUAGE = {"animali", "colori", "mestieri", "cibo", "piante", "nobili", "chiesa", "calendario"}


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

    # ------------------------------------------------------------------ bearers of a word, in a competition
    def _bearers(self) -> None:
        """comp -> normalised word -> every player (notable or not) whose name contains that word and who appears in any
        row of the competition: presences, appearance rows, line-ups, goals. A wrong option must have no bearer at all."""
        t = self.t
        cmp = ",".join(f"'{c}'" for c in COMPS)
        rows = t.q(f"""select distinct gm.comp, x.pid from (
                select gid, pid from pres union select gid, pid from apx union select gid, pid from lu union select gid, pid from goal
            ) x join gm using(gid) where gm.comp in ({cmp}) and x.pid is not null""")
        self.bearers = defaultdict(lambda: defaultdict(set))
        for comp, pid in rows:
            pid = int(pid)
            p = t.players.get(pid)
            names = [p["name"] or "", p["last"] or "", p["first"] or ""] if p else [t.lu_names.get(pid, "")]
            for w in {w for n in names for w in norm(n).split()}:
                self.bearers[comp][w].add(pid)
        self.goal_window = {comp: t.window(comp, None, "goal", 1) for comp in COMPS}
        self.pres_window = {comp: t.window(comp, None, "pres", 1) for comp in COMPS}
        self.goals_w = defaultdict(int)  # (pid, comp) -> goals inside the complete goal window
        for pid, lst in self.pgoals.items():
            for d, comp, season, gid, club, n in lst:
                w = self.goal_window.get(comp)
                if w and w[0] <= season <= w[1]:
                    self.goals_w[(pid, comp)] += n

    def phrase(self, cat: str, lang: str) -> str:
        base = PHRASE[cat]
        extra = lexicon.LANG_NAME.get(lang, "") if cat in BY_LANGUAGE else ""
        return f"{base} {extra}".strip()

    def lang_of(self, cat: str, note: str) -> str:
        if cat not in BY_LANGUAGE:
            return "*"
        first = re.split(r"[ (,]", note.strip())[0]
        return lexicon.LANG_CODE.get(first, "?")

    def _real_surnames(self) -> None:
        """Every one-word surname of a footballer in the dataset (any league, any level), as written: «Volpi», «Orsi»…"""
        self.real_surname: dict[str, str] = {}
        self.best_bearer: dict[str, int] = {}  # surname -> its best-known bearer in the whole dataset
        t = self.t
        for pid, p in t.players.items():
            last = (p["last"] or "").strip()
            if p["first"] and last and len(re.split(r"[\s\-]+", last)) == 1:
                k = last.lower()
                self.real_surname.setdefault(k, last)  # accents kept: «Fariña» is not «Farina»
                if k not in self.best_bearer or (t.fame(pid), -pid) > (t.fame(self.best_bearer[k]), -self.best_bearer[k]):
                    self.best_bearer[k] = pid

    def decoy_pool(self, cat: str, lang: str, word: str, comp: str, fame: int) -> list[str]:
        """Wrong options that look exactly like the right one (SPEC §4.1, v7.2): words of the same family and language
        that are the surname of a real footballer somewhere in the dataset («Volpi», «Orsi», «Lupi»), but of nobody
        who ever played in this competition. Italian words keep the number of the right one (Gatti with Volpi).

        v10: only surnames of a known footballer (one who passes the notoriety filter), as famous as the bearer of the
        right one, closest first: four names that all ring a bell, and the question is which of them played there."""
        family = "storia" if cat == "dittatori" else cat
        words = [w for w, (meaning, note) in lexicon.CATEGORIES[family].items()
                 if (cat != "dittatori" or note == "dittatore") and (lang == "*" or self.lang_of(family, note) == lang)]
        if lang == "it":
            plural = word.lower().endswith("i")
            words = [w for w in words if w.endswith("i") == plural]
        used = self.bearers[comp]
        out = []
        for w in words:
            k = norm(w)
            if " " in w or k == norm(word) or k in used or w.lower() not in self.real_surname or not self.t.is_notable(self.best_bearer[w.lower()]):
                continue
            out.append(self.real_surname[w.lower()])
        return self.t.near_in_fame(fame, sorted(set(out)), key=lambda x: self.best_bearer[x.lower()], seed=(word, comp))

    def known_as(self, surname: str) -> str:
        """«Leão (Rafael Leão, Lille)»: who the wrong surname belongs to, for the Copione."""
        return self.t.pname(self.best_bearer[surname.lower()])

    def candidates(self) -> list[tuple[int, str, str, str]]:
        """(pid, category, surname as written, language) for every notable player whose whole surname is one word of the lexicon."""
        out = []
        for (pid, cat), (w, meaning, note) in self.word.items():
            p = self.t.players[pid]
            last = (p["last"] or "").strip()
            # a real surname of one word, next to a first name: stage names ("Chory Castro", "Ganso") are not surnames
            if not p["first"] or not last or len(re.split(r"[\s\-]+", last)) != 1 or norm(last) != norm(w):
                continue
            lang = self.lang_of(cat, note)
            if lang == "?":
                continue
            out.append((pid, cat, (p["last"] or p["name"]).strip(), lang))
        return sorted(out, key=lambda x: (-self.t.fame(x[0]), x))

    def put(self, gen: str, key, question: str, correct: str, wrong: list[str], *, pid: int, comp: str, year: int, script: str) -> bool:
        t = self.t
        ok = self.add(gen, key, question, correct, wrong, year=year, fame=t.fame(pid), comp=comp, archetype=6,
                      entities=[f"comp:{comp}", t.pid(pid)], sources=[SRC_DATASET, t.src_player(pid)], script=script)
        if ok:
            self.out[-1]["tag"] = "nomi"
        return ok

    @staticmethod
    def cap(w: str) -> str:
        return w[:1].upper() + w[1:]

    def meaning(self, pid: int, cat: str) -> str:
        w, meaning, note = self.word[(pid, cat)]
        if cat in ("storia", "dittatori"):
            return f"«{w}» come {meaning}"
        if cat == "citta":
            return f"«{w}» come la città di {meaning} ({note})"
        if meaning.lower() == w.lower():
            return f"«{w}», proprio come la parola {('in ' + note) if note != lexicon.IT else 'italiana'}"
        return f"«{w}» significa «{meaning}» in {note}"

    # ------------------------------------------------------------------ "which of these surnames belongs to a player who played in Serie A?"
    def played(self, variants: int = 2) -> None:
        t = self.t
        done = set()
        for pid, cat, surname, lang in self.candidates():
            for comp in COMPS:
                if (norm(surname), comp) in done:
                    continue  # one question per surname and competition (the most famous bearer tells the story)
                w = self.pres_window.get(comp)
                seasons = [s for (p, c, s) in self.apps if p == pid and c == comp and w and w[0] <= s <= w[1]]
                if not w or not seasons:
                    continue
                pool = self.decoy_pool(cat, lang, surname, comp, t.fame(pid))
                if len(pool) < 3:
                    continue
                n_apps = sum(self.apps[(pid, comp, s)] for s in seasons)
                done.add((norm(surname), comp))
                span = f"dal {season_label(w[0])} al {season_label(w[1])}"
                q = f"Quale di questi cognomi ({self.phrase(cat, lang)}) appartiene a un giocatore che ha giocato {IN_COMP[comp]} ({span})?"
                for k in range(variants):
                    trio = pool[3 * k:3 * k + 3]
                    if len(trio) < 3:
                        break
                    wrong = list(trio)
                    who = ", ".join(self.known_as(x) for x in wrong)
                    self.put(f"nomi_{cat}", (pid, comp, k), q, surname, wrong, pid=pid, comp=comp, year=min(seasons),
                             script=f"{surname} è il cognome di {t.pname(pid)}: {n_apps} presenze {IN_COMP[comp]} {span}. {self.cap(self.meaning(pid, cat))}. "
                                    f"{', '.join(wrong[:-1])} e {wrong[-1]} sono cognomi di calciatori veri ({who}), ma nessun giocatore con quei cognomi "
                                    f"ha mai giocato {IN_COMP[comp]} in queste stagioni.")

    # ------------------------------------------------------------------ "... who scored at least N goals in Serie A?"
    def scored(self, variants: int = 2) -> None:
        t = self.t
        done = set()
        for pid, cat, surname, lang in sorted(self.candidates(), key=lambda x: -max(self.goals_w[(x[0], c)] for c in COMPS)):
            for comp in COMPS:
                w = self.goal_window.get(comp)
                if not w or (norm(surname), comp) in done:
                    continue
                # one player with that surname reached the threshold by himself
                g = self.goals_w[(pid, comp)]
                n = next((x for x in THRESHOLDS if g >= x), None)
                if n is None:
                    continue
                done.add((norm(surname), comp))
                span = f"dal {season_label(w[0])} al {season_label(w[1])}"
                pool = self.decoy_pool(cat, lang, surname, comp, t.fame(pid))
                # real surnames of the same family whose bearers scored far fewer: the closest wrong options
                near = []
                for p2, cat2, sur2, lang2 in self.candidates():
                    if cat2 == cat and lang2 == lang and norm(sur2) != norm(surname) and sur2 not in near:
                        bearers = self.bearers[comp].get(norm(sur2), set())
                        if bearers and sum(self.goals_w[(b, comp)] for b in bearers) <= n // 4:
                            near.append(sur2)
                near = t.near_in_fame(t.fame(pid), near, key=lambda x: max(self.bearers[comp].get(norm(x), {pid}), key=t.fame))
                q = f"Quale di questi cognomi ({self.phrase(cat, lang)}) appartiene a un giocatore che ha segnato almeno {n} gol {IN_COMP[comp]} ({span})?"
                for k in range(variants):
                    wrong = (near[k:k + 1] + pool[3 * k:3 * k + 3])[:3]
                    if len(set(wrong)) < 3:
                        break
                    notes = []
                    for x in wrong:
                        bs = self.bearers[comp].get(norm(x), set())
                        if bs:
                            tot = sum(self.goals_w[(b, comp)] for b in bs)
                            notes.append(f"{x}: {tot} gol" + (f" in tutto ({len(bs)} giocatori)" if len(bs) > 1 else ""))
                        else:
                            notes.append(f"{x}: come {self.known_as(x)}, che lì non ha mai giocato")
                    self.put("nomi_gol", (cat, pid, comp, n, k), q, surname, wrong, pid=pid, comp=comp, year=w[0],
                             script=f"{t.pname(pid)} ha segnato {self.goals_w[(pid, comp)]} gol {IN_COMP[comp]} {span}. {self.cap(self.meaning(pid, cat))}. "
                                    f"Gli altri cognomi: {'; '.join(notes)}.")

    def run(self) -> list[dict]:
        self._bearers()
        self._real_surnames()
        # one question per surname (SPEC §4.1, v10): the same answer with other company is the same question
        self.played(variants=1)
        self.scored(variants=1)
        return self.out


def generate(t) -> dict[str, list[dict]]:
    return {"tiro_secco": Nomi(t).run()}

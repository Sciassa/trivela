"""Il Frame: an iconic match told by its anonymous event timeline (SPEC §4.8).

Two kinds of question on the same facts:
  * ``match``: goals with the running score and cards, only the competition and stage are given: which match is it?
  * ``score``: the match is named, goals and cards are given as bare minutes: what was the final score?
Every distractor is another iconic match (or score) checked to be different on the same data.
"""

from __future__ import annotations

import random
from collections import defaultdict

from .postprocess import is_show_case
from .tm_core import COMP_IT, TM, base, date_it, round_it, season_label
from .gen_matches import weight

BIG_FIVE = ("Juventus", "Inter", "Milan", "Napoli", "Roma")


def iconic_games(t: TM) -> list[dict]:
    """Finals, semi-finals and quarter-finals, World Cups and Euros knock-outs, the Italian cups' deciders, the Serie A clashes between
    the big five and the top-four clashes of the other leagues."""
    five = ",".join(str(c) for c in t.top_clubs["IT1"] if t.club(c) in BIG_FIVE)
    top = {lg: ",".join(str(c) for c in t.top_clubs[lg][:4]) for lg in ("GB1", "ES1", "L1", "FR1")}
    others = " ".join(f"or (comp = '{lg}' and home in ({ids}) and away in ({ids}))" for lg, ids in top.items())
    where = f"""(comp = 'CL' and (round ilike '%final%'))
        or (comp in ('FIWC', 'EURO') and round not ilike 'group%')
        or (comp in ('EL', 'CIT') and round ilike '%final%' and round not ilike '%quarter%')
        or (comp in ('SCI', 'USC') and round ilike '%final%')
        or (comp = 'IT1' and home in ({five}) and away in ({five}))
        {others}"""
    return [g for g in t.games(f"({where}) and ev_ok") if g["fh"] is not None]


def stage_label(t: TM, g: dict) -> str:
    """Competition and stage without season or year: the heading of the question."""
    import re

    comp, rnd = g["comp"], g["round"] or ""
    m = re.match(r"(\d+)\. Matchday", rnd)
    stage = f"{m.group(1)}ª giornata" if m else round_it(rnd)
    return COMP_IT[comp] + (f" · {stage}" if stage else "")


def when(g: dict) -> str:
    return str(g["date"].year) if g["comp"] in ("FIWC", "EURO") else season_label(g["season"])


class Frames:
    def __init__(self, t: TM):
        self.t = t
        self.games = iconic_games(t)
        ids = ",".join(str(g["gid"]) for g in self.games)
        self.goals = defaultdict(list)
        for gid, minute, club, pid, own, pen in t.q(f"select gid, minute, club, pid, own, pen from goal where gid in ({ids}) order by gid, minute, pid"):
            self.goals[gid].append({"min": int(minute), "club": int(club), "pid": int(pid), "own": own, "pen": pen})
        self.cards = defaultdict(list)
        for gid, minute, club, descr in t.q(f"select gid, minute, club, descr from ev where type = 'Cards' and pid is not null and gid in ({ids}) order by gid, minute"):
            d = (descr or "").lower()
            kind = "second_yellow" if d.startswith("second yellow") else "red" if d.startswith("red card") else "yellow" if "yellow card" in d else None
            if kind:
                self.cards[gid].append({"min": int(minute), "club": int(club), "kind": kind})

    def timeline(self, g: dict, *, anonymous: bool) -> list[dict] | None:
        """Goals (with the running score) and cards in chronological order; None when the game has no card data."""
        if not self.cards.get(g["gid"]):
            return None
        rows = [("goal", x) for x in self.goals[g["gid"]]] + [(x["kind"], x) for x in self.cards[g["gid"]]]
        rows.sort(key=lambda r: (r[1]["min"], 0 if r[0] == "goal" else 1))
        out, sc = [], [0, 0]
        for kind, x in rows:
            side = 0 if x["club"] == g["home"] else 1
            e: dict = {"minute": x["min"], "kind": kind}
            if kind == "goal":
                sc[side] += 1
                if not anonymous:
                    e["score"] = list(sc)
            elif not anonymous:
                e["side"] = side
            out.append(e)
        return out

    def signature(self, g: dict) -> tuple:
        return (tuple((x["min"], x["club"] == g["home"]) for x in self.goals[g["gid"]]), tuple((x["min"], x["club"] == g["home"], x["kind"]) for x in self.cards[g["gid"]]))

    def script(self, g: dict) -> str:
        t = self.t
        goals = ", ".join(f"{x['min']}' {t.pname(x['pid'])}" + (" (aut.)" if x["own"] else " (rig.)" if x["pen"] else "") for x in self.goals[g["gid"]])
        return f"{t.label(g)} ({t.ctx(g)}, {date_it(g['date'])}). I gol: {goals}."

    def option(self, g: dict) -> str:
        return f"{self.t.teams(g)} · {when(g)}"

    def run(self) -> list[dict]:
        t, out = self.t, []
        by_comp = defaultdict(list)
        for g in self.games:
            if self.cards.get(g["gid"]):
                by_comp[g["comp"]].append(g)
        for g in self.games:
            if is_show_case({"x": f"{t.label(g)} {when(g)} {g['round']} {t.ctx(g)}"}):
                continue
            teams = t.teams(g)
            if not self.goals[g["gid"]]:
                continue
            ents = [f"comp:{g['comp']}", t.cid(g["home"]), t.cid(g["away"])]
            fame = weight(t, g)
            r = random.Random(g["gid"])
            # ---- which match?
            tl = self.timeline(g, anonymous=False)
            if tl:
                pool = [h for h in by_comp[g["comp"]] if h["gid"] != g["gid"] and (h["fh"], h["fa"]) != (g["fh"], g["fa"])
                        and self.signature(h) != self.signature(g) and self.option(h) != self.option(g)]
                same_stage = [h for h in pool if (h["round"] or "").split()[0:1] == (g["round"] or "").split()[0:1]]
                ds = r.sample(same_stage, min(len(same_stage), 6)) if len(same_stage) >= 3 else r.sample(pool, min(len(pool), 6))
                opts = list(dict.fromkeys(self.option(h) for h in ds if self.option(h) != self.option(g)))
                if len(opts) >= 3:
                    o = r.sample(opts, 3) + [self.option(g)]
                    r.shuffle(o)
                    it = base("frame_partita", (g["gid"], "match"), year=g["date"].year, fame=fame, entities=ents, sources=[t.src_game(g)], script=self.script(g))
                    it.update({"mode": "match", "heading": stage_label(t, g), "events": tl, "question": "Di quale partita si tratta?",
                               "options": o, "correct": o.index(self.option(g))})
                    out.append(it)
            # ---- final score
            n = g["fh"] + g["fa"]
            tl = self.timeline(g, anonymous=True)
            if tl and n >= 3 and not g["pens"]:
                splits = [f"{a}-{n - a}" for a in range(n + 1)]
                right = f"{g['fh']}-{g['fa']}"
                o = r.sample([s for s in splits if s != right], 3) + [right]
                r.shuffle(o)
                it = base("frame_risultato", (g["gid"], "score"), year=g["date"].year, fame=fame, entities=ents, sources=[t.src_game(g)], script=self.script(g))
                it.update({"mode": "score", "heading": f"{teams} · {t.ctx(g)}", "events": tl, "question": f"Com'è finita {teams}?",
                           "options": o, "correct": o.index(right)})
                out.append(it)
        return out


def generate(t: TM) -> dict[str, list[dict]]:
    items = Frames(t).run()
    items.sort(key=lambda x: (-x["fame"], x["id"]))
    return {"frame": items}

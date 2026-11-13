"""La Formazione, built on single famous matches."""

from __future__ import annotations

import random
from collections import defaultdict

from .tm_core import L5, POS_XY, TM, WEEKDAYS, base, date_it, season_label


def famous_games(t: TM) -> list[dict]:
    """Champions League, finals and semi-finals of the cups, big league matches, World Cups and Euros."""
    big = ",".join(str(c) for c in t.big)
    it = ",".join(str(c) for c in t.sa_clubs)
    tops = {lg: ",".join(str(c) for c in t.top_clubs[lg][:8 if lg == "IT1" else 5]) for lg in L5}
    league = " or ".join(f"(comp = '{lg}' and home in ({tops[lg]}) and away in ({tops[lg]}))" for lg in L5)
    where = f"""(comp = 'CL' and (round ilike '%final%' or round ilike '%last 16%' or home in ({big}) or away in ({big})))
        or (comp in ('EL','UCOL') and (round ilike '%final%' or ((home in ({it}) or away in ({it})) and round not ilike '%group%' and round not ilike '%matchday%')))
        or (comp = 'CIT' and round ilike '%final%') or comp in ('SCI','USC','FIWC','EURO') or {league}"""
    return t.games(f"({where})")


def weight(t: TM, g: dict) -> int:
    w = {"CL": 60, "FIWC": 70, "EURO": 65, "IT1": 55, "SCI": 50, "USC": 45, "CIT": 45, "EL": 40, "UCOL": 35}.get(g["comp"], 35)
    rnd = (g["round"] or "").lower()
    if "final" in rnd and "semi" not in rnd and "quarter" not in rnd:
        w += 25
    elif "semi" in rnd or "quarter" in rnd:
        w += 12
    if g["home"] in t.big and g["away"] in t.big:
        w += 10
    return w


class Matches:
    def __init__(self, t: TM):
        self.t = t
        self.games = famous_games(t)
        ids = ",".join(str(g["gid"]) for g in self.games)
        self.goals = defaultdict(list)
        for gid, minute, club, pid, own, pen in t.q(f"select gid, minute, club, pid, own, pen from goal where gid in ({ids}) order by gid, minute"):
            self.goals[gid].append({"min": int(minute), "club": int(club), "pid": int(pid), "own": own, "pen": pen})
        self.lineups = defaultdict(list)
        for gid, club, pid, pos, num, cap in t.q(f"select gid, club, pid, pos, num, cap from lu where starter and gid in ({ids})"):
            self.lineups[(gid, int(club))].append({"pid": int(pid), "pos": pos, "num": num, "cap": cap})

    def ents(self, g: dict) -> list[str]:
        return [f"comp:{g['comp']}", self.t.cid(g["home"]), self.t.cid(g["away"])]

    def goal_txt(self, g: dict, x: dict, hide: int | None = None) -> str:
        t = self.t
        name = "{{0}}" if x["pid"] == hide else t.pname(x["pid"])
        tag = " (aut.)" if x["own"] else " (rig.)" if x["pen"] else ""
        return f"{x['min']}' {name}{tag}"

    # ------------------------------------------------------------------ La Formazione
    def formazione(self) -> list[dict]:
        t, out = self.t, []
        for g in self.games:
            if not g["ev_ok"] and not (g["fh"] is not None and not g["pens"]):
                continue
            if g["pens"] and not g["ev_ok"]:
                continue
            teams, all_ids = [], []
            for club, form in ((g["home"], g["hform"]), (g["away"], g["aform"])):
                pl = self.lineups.get((g["gid"], club), [])
                if len(pl) != 11 or any(p["pos"] not in POS_XY for p in pl) or sum(1 for p in pl if p["pos"] == "Goalkeeper") != 1:
                    break
                r = random.Random(f"{g['gid']}-{club}")
                outfield = [p["pid"] for p in pl if p["pos"] != "Goalkeeper"]
                notable = [p for p in outfield if t.is_notable(p)]
                if len(notable) < 5:
                    break
                hidden = set(r.sample(notable, 5))
                spread = defaultdict(list)
                for p in pl:
                    spread[POS_XY[p["pos"]]].append(p)
                players = []
                for (x, y), ps in spread.items():
                    for k, p in enumerate(ps):
                        xx = x if len(ps) == 1 else min(0.92, max(0.08, x + (k - (len(ps) - 1) / 2) * 0.2))
                        players.append({"id": t.pid(p["pid"]), "name": t.pname(p["pid"]), "number": p["num"], "x": round(xx, 3), "y": y,
                                        "hidden": p["pid"] in hidden})
                        all_ids.append(t.pid(p["pid"]))
                teams.append({"id": t.cid(club), "name": t.club(club), "formation": form or "", "players": players})
            if len(teams) != 2:
                continue
            forms = " e ".join(x["formation"] for x in teams if x["formation"])
            it = base("formazione", g["gid"], year=g["date"].year, fame=weight(t, g), entities=self.ents(g) + all_ids, sources=[t.src_game(g)],
                      script=f"Le formazioni titolari di {t.label(g)} ({t.ctx(g)}, {date_it(g['date'])})"
                             + (f": moduli {forms}." if forms else "."))
            it.update({"title": t.label(g), "date": date_it(g["date"]), "competition": t.ctx(g), "teams": teams})
            out.append(it)
        return out


def generate(t: TM) -> dict[str, list[dict]]:
    items = Matches(t).formazione()
    items.sort(key=lambda x: -x["fame"])
    return {"formazione": items[:2000]}


__all__ = ["generate", "famous_games", "season_label"]

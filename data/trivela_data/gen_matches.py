"""Games built on single famous matches: Il Frame, Prima Pagina, La Formazione."""

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

    # ------------------------------------------------------------------ Il Frame
    def frame(self) -> list[dict]:
        t, out = self.t, []
        for g in self.games:
            gl = self.goals.get(g["gid"])
            if not g["ev_ok"] or not gl or len(gl) < 2:
                continue
            mins = [x["min"] for x in gl]
            cands = [m for m in range(6, 86) if m not in (44, 45, 46, 47) and all(abs(m - x) >= 2 for x in mins) and any(x < m for x in mins)]
            if not cands:
                continue
            m = random.Random(g["gid"]).choice(cands)
            before = [x for x in gl if x["min"] < m]
            sc = [sum(1 for x in before if x["club"] == g["home"]), sum(1 for x in before if x["club"] == g["away"])]
            last = before[-1]
            home, away = t.club(g["home"], g["hname"]), t.club(g["away"], g["aname"])
            it = base("frame", (g["gid"], m), year=g["date"].year, fame=weight(t, g), entities=self.ents(g), sources=[t.src_game(g)],
                      script=f"{t.label(g)} ({t.ctx(g)}, {date_it(g['date'])}). Al {m}' il punteggio era {sc[0]}-{sc[1]}. "
                             f"I gol: {', '.join(self.goal_txt(g, x) for x in gl)}.")
            it.update({"match": f"{home}-{away} · {t.ctx(g)}", "date": date_it(g["date"]), "minute": m, "teams": [home, away], "scoreAt": sc})
            if not last["own"] and t.is_notable(last["pid"]):
                it["lastScorer"] = t.answer(last["pid"])
            out.append(it)
        return out

    # ------------------------------------------------------------------ Prima Pagina
    def prima_pagina(self) -> list[dict]:
        t, out = self.t, []
        for g in self.games:
            gl = self.goals.get(g["gid"])
            if not g["ev_ok"] or not gl:
                continue
            scorers = [x for x in gl if not x["own"] and t.is_notable(x["pid"])]
            if not scorers:
                continue
            r = random.Random(g["gid"])
            hid = r.choice(scorers)
            home, away = t.club(g["home"], g["hname"]), t.club(g["away"], g["aname"])
            kinds = []
            if g["referee"]:
                kinds.append(("Arbitro", {"kind": "entity", "ids": [t.rid(g["referee"])], "display": g["referee"]}, g["referee"]))
            for man, club in ((g["hman"], home), (g["aman"], away)):
                if man:
                    kinds.append((f"Allenatore · {club}", {"kind": "entity", "ids": [t.mid(man)], "display": man}, man))
            others = [x for x in scorers if x["pid"] != hid["pid"]]
            if others:
                o = r.choice(others)
                kinds.append(("Altro marcatore", t.answer(o["pid"]), t.pname(o["pid"])))
            if not kinds:
                continue
            label2, ans2, hidden2 = r.choice(kinds)

            def mask(text: str) -> str:
                return text.replace(hidden2, "{{1}}") if hidden2 else text

            goals_txt = ", ".join(self.goal_txt(g, x, hid["pid"]) for x in gl)
            goals_txt = mask(goals_txt)
            sa, sb = g["fh"], g["fa"]
            cap = lambda x: x[:1].upper() + x[1:]  # noqa: E731
            head = (f"{cap(t.il(g['home']))} batte {t.il(g['away'])} {sa}-{sb}" if sa > sb
                    else f"{cap(t.il(g['away']))} passa in casa {t.di(g['home'])}: {sb}-{sa}" if sb > sa
                    else f"{home}-{away}, finisce {sa}-{sb}")
            if g["pens"]:
                head = f"{home}-{away} {sa}-{sb}: decidono i rigori"
            box = [f"{home}-{away} {sa}-{sb}", f"Reti: {goals_txt}"]
            if g["referee"]:
                box.append(mask(f"Arbitro: {g['referee']}"))
            if g["hman"] and g["aman"]:
                box.append(mask(f"Allenatori: {g['hman']} ({home}), {g['aman']} ({away})"))
            if g["stadium"]:
                box.append(f"Stadio: {g['stadium']}" + (f" · spettatori {int(g['attendance']):,}".replace(",", ".") if g["attendance"] else ""))
            for club, nm in ((g["home"], home), (g["away"], away)):
                lu = self.lineups.get((g["gid"], club))
                if lu and len(lu) == 11 and all(p["pos"] in POS_XY for p in lu):
                    lu = sorted(lu, key=lambda p: (POS_XY[p["pos"]][1], POS_XY[p["pos"]][0]))
                    names = ", ".join("{{0}}" if p["pid"] == hid["pid"] else t.surname(p["pid"]) for p in lu)
                    box.append(mask(f"{nm} ({(g['hform'] if club == g['home'] else g['aform']) or 'titolari'}): {names}"))
            who = ", ".join(dict.fromkeys(("{{0}}" if x["pid"] == hid["pid"] else t.surname(x["pid"])) for x in gl if not x["own"]))
            page = {"masthead": "La Trivela Sportiva", "date": date_it(g["date"]), "weekday": WEEKDAYS[g["date"].weekday()],
                    "kicker": t.ctx(g), "headline": head, "subhead": mask(f"A segno {who}"),
                    "body": [mask(f"{date_it(g['date']).capitalize()}. {home} e {away} si affrontano"
                                  f"{' allo stadio ' + g['stadium'] if g['stadium'] else ''}: finisce {sa}-{sb}."),
                             f"La sequenza delle reti: {goals_txt}."],
                    "boxTitle": "Il tabellino", "boxLines": box}
            n1, n2 = t.pname(hid["pid"]), hidden2
            it = base("prima_pagina", g["gid"], year=g["date"].year, fame=max(weight(t, g), t.fame(hid["pid"])), entities=self.ents(g) + [t.pid(hid["pid"])],
                      sources=[t.src_game(g)], script=f"{t.label(g)} ({t.ctx(g)}): tra i marcatori {n1}; {label2.split(' · ')[0].lower()}: {n2}.")
            bucket = lambda s: 1 if len(s) < 9 else 2 if len(s) < 16 else 3  # noqa: E731
            it.update({"page": page, "slots": [{"label": "Marcatore", "answer": t.answer(hid["pid"]), "lengthBucket": bucket(n1)},
                                               {"label": label2, "answer": ans2, "lengthBucket": bucket(n2)}]})
            out.append(it)
        return out

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
    m = Matches(t)
    out = {"frame": m.frame(), "prima_pagina": m.prima_pagina(), "formazione": m.formazione()}
    for k in out:
        out[k].sort(key=lambda x: -x["fame"])
    out["frame"] = out["frame"][:2500]
    out["prima_pagina"] = out["prima_pagina"][:2500]
    out["formazione"] = out["formazione"][:2000]
    return out


__all__ = ["generate", "famous_games", "season_label"]

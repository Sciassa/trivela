"""La Formazione, built on single famous matches."""

from __future__ import annotations

import random
from collections import defaultdict

from .tm_core import L5, POS_XY, TM, WEEKDAYS, base, date_it, season_label


# Historic derbies and rivalries of the five leagues, by the names the app shows (SPEC §4.6).
DERBIES = {
    "IT1": [("Inter", "Milan"), ("Roma", "Lazio"), ("Juventus", "Torino"), ("Genoa", "Sampdoria"), ("Juventus", "Inter"), ("Juventus", "Milan"),
            ("Napoli", "Roma"), ("Juventus", "Napoli"), ("Fiorentina", "Juventus"), ("Verona", "Chievo"), ("Bologna", "Fiorentina"),
            ("Palermo", "Catania"), ("Atalanta", "Brescia"), ("Juventus", "Roma"), ("Inter", "Napoli")],
    "GB1": [("Arsenal", "Tottenham"), ("Manchester United", "Manchester City"), ("Liverpool", "Everton"), ("Liverpool", "Manchester United"),
            ("Chelsea", "Arsenal"), ("Chelsea", "Tottenham"), ("Newcastle", "Sunderland"), ("West Ham", "Tottenham"), ("Crystal Palace", "Brighton"),
            ("Manchester United", "Leeds"), ("Arsenal", "Manchester United"), ("Liverpool", "Manchester City"), ("Chelsea", "Liverpool")],
    "ES1": [("Real Madrid", "Barcellona"), ("Real Madrid", "Atlético Madrid"), ("Barcellona", "Espanyol"), ("Siviglia", "Real Betis"),
            ("Athletic Bilbao", "Real Sociedad"), ("Valencia", "Levante"), ("Valencia", "Villarreal"), ("Celta Vigo", "Dep. La Coruña"),
            ("Barcellona", "Atlético Madrid"), ("Real Madrid", "Athletic Bilbao")],
    "L1": [("Bayern Monaco", "Borussia Dortmund"), ("Borussia Dortmund", "Schalke 04"), ("Amburgo", "Werder Brema"), ("Colonia", "Borussia Mönchengladbach"),
           ("Colonia", "Bayer Leverkusen"), ("Hertha Berlino", "Union Berlin"), ("Bayern Monaco", "Borussia Mönchengladbach"), ("Bayern Monaco", "Norimberga"),
           ("Eintracht Francoforte", "Magonza"), ("Amburgo", "St. Pauli"), ("Bayern Monaco", "Bayer Leverkusen")],
    "FR1": [("PSG", "Marsiglia"), ("Lione", "Saint-Étienne"), ("Lione", "Marsiglia"), ("Nizza", "Monaco"), ("Lille", "Lens"), ("Nantes", "Rennes"),
            ("Bordeaux", "Toulouse"), ("PSG", "Lione"), ("Marsiglia", "Monaco"), ("PSG", "Monaco")],
}
CUPS = ("CL", "EL", "UCOL", "FIWC", "EURO", "CIT", "SCI", "USC")
# from the quarter-finals on (finals for third place included); the super cups are finals by nature
LATE_ROUND = "(round ilike '%quarter%' or round ilike '%semi%' or round ilike '%final%' or round ilike '%third place%')"
TOP_GAME_FROM = 10  # a meeting between first and second counts as a title clash from this matchday on


def title_clashes(t: TM) -> set[int]:
    """League games in which the first and the second of the table met (standings computed on the results, before kick-off)."""
    out: set[int] = set()
    for lg in L5:
        rows = t.q("select gid, season, date, home, away, hg, ag, round from gm where comp = ? order by season, date, gid", lg)
        by_season = defaultdict(list)
        for r in rows:
            by_season[int(r[1])].append(r)
        for games in by_season.values():
            pts, gd, gf, played = defaultdict(int), defaultdict(int), defaultdict(int), defaultdict(int)
            days = defaultdict(list)
            for g in games:
                days[g[2]].append(g)
            for day in sorted(days):  # games of the same day never see each other's result
                table = sorted(pts, key=lambda c: (-pts[c], -gd[c], -gf[c]))
                for gid, _s, _d, h, a, hg, ag, _rnd in days[day]:
                    if len(table) >= 2 and {int(h), int(a)} == set(table[:2]) and min(played[int(h)], played[int(a)]) >= TOP_GAME_FROM - 1:
                        # an undisputed top two: nobody level on points with the second
                        if len(table) < 3 or pts[table[2]] < pts[table[1]]:
                            out.add(int(gid))
                for gid, _s, _d, h, a, hg, ag, _rnd in days[day]:
                    h, a, hg, ag = int(h), int(a), int(hg), int(ag)
                    played[h] += 1
                    played[a] += 1
                    gf[h] += hg
                    gf[a] += ag
                    gd[h] += hg - ag
                    gd[a] += ag - hg
                    pts[h] += 3 if hg > ag else 1 if hg == ag else 0
                    pts[a] += 3 if ag > hg else 1 if hg == ag else 0
    return out


def iconic_games(t: TM) -> list[dict]:
    """Only memorable matches (SPEC §4.6): cups from the quarter-finals on, historic derbies, first against second, freak scores."""
    cups = ",".join(f"'{c}'" for c in CUPS)
    games = {g["gid"]: dict(g, why="coppa") for g in t.games(f"comp in ({cups}) and {LATE_ROUND}")}
    name_id = defaultdict(dict)
    for lg in L5:
        for (cid,) in t.q("select home from gm where comp = ? group by 1", lg):
            name_id[lg][t.club(cid)] = int(cid)
    for lg, pairs in DERBIES.items():
        for a, b in pairs:
            if a not in name_id[lg] or b not in name_id[lg]:
                raise SystemExit(f"Derby con un nome sconosciuto: {lg} {a}-{b}")
            x, y = name_id[lg][a], name_id[lg][b]
            for g in t.games("comp = ? and ((home = ? and away = ?) or (home = ? and away = ?))", lg, x, y, y, x):
                games.setdefault(g["gid"], dict(g, why="derby"))
    clashes = title_clashes(t)
    leagues = ",".join(f"'{c}'" for c in L5)
    for g in t.games(f"comp in ({leagues})"):
        if g["gid"] in clashes:
            games.setdefault(g["gid"], dict(g, why="vetta"))
        elif g["fh"] is not None and (g["fh"] + g["fa"] >= 8 or abs(g["fh"] - g["fa"]) >= 6):
            games.setdefault(g["gid"], dict(g, why="punteggio"))
    return list(games.values())


def famous_games(t: TM) -> list[dict]:
    """Champions League, finals and semi-finals of the cups, big league matches, World Cups and Euros (used by the quiz for its weights)."""
    big = ",".join(str(c) for c in t.big)
    it = ",".join(str(c) for c in t.sa_clubs)
    tops = {lg: ",".join(str(c) for c in t.top_clubs[lg][:8 if lg == "IT1" else 5]) for lg in L5}
    league = " or ".join(f"(comp = '{lg}' and home in ({tops[lg]}) and away in ({tops[lg]}))" for lg in L5)
    where = f"""(comp = 'CL' and (round ilike '%final%' or round ilike '%last 16%' or home in ({big}) or away in ({big})))
        or (comp in ('EL','UCOL') and (round ilike '%final%' or ((home in ({it}) or away in ({it})) and round not ilike '%group%' and round not ilike '%matchday%')))
        or (comp = 'CIT' and round ilike '%final%') or comp in ('SCI','USC','FIWC','EURO') or {league}"""
    return t.games(f"({where})")


WHY_IT = {"coppa": "", "derby": "Derby e grandi classiche", "vetta": "Scontro al vertice: prima contro seconda", "punteggio": "Risultato fuori scala"}


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
        self.games = iconic_games(t)
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
    def formazione(self, variant: int = 0, only: set[str] | None = None) -> list[dict]:
        """One instance per iconic game; `variant` > 0 hides a different five (for the games listed in `only`)."""
        t, out = self.t, []
        for g in self.games:
            if only is not None and g["why"] not in only:
                continue
            if not g["ev_ok"] and not (g["fh"] is not None and not g["pens"]):
                continue
            if g["pens"] and not g["ev_ok"]:
                continue
            teams, all_ids = [], []
            for club, form in ((g["home"], g["hform"]), (g["away"], g["aform"])):
                pl = self.lineups.get((g["gid"], club), [])
                if len(pl) != 11 or any(p["pos"] not in POS_XY for p in pl) or sum(1 for p in pl if p["pos"] == "Goalkeeper") != 1:
                    break
                r = random.Random(f"{g['gid']}-{club}" + (f"-{variant}" if variant else ""))
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
            it = base(f"formazione_{g['why']}", (g["gid"], variant) if variant else g["gid"], year=g["date"].year, fame=weight(t, g), entities=self.ents(g) + all_ids, sources=[t.src_game(g)],
                      script=f"Le formazioni titolari di {t.label(g)} ({t.ctx(g)}, {date_it(g['date'])})"
                             + (f": moduli {forms}." if forms else "."))
            it.update({"title": t.label(g), "date": date_it(g["date"]), "competition": t.ctx(g) + (f" · {WHY_IT[g['why']]}" if WHY_IT[g["why"]] else ""),
                       "teams": teams})
            out.append(it)
        return out


def generate(t: TM) -> dict[str, list[dict]]:
    m = Matches(t)
    items = m.formazione()
    # the same great cup night can come back with a different five to find: there are not a thousand quarter-finals
    items += m.formazione(1, {"coppa"})
    items.sort(key=lambda x: -x["fame"])
    return {"formazione": items}


__all__ = ["generate", "famous_games", "season_label"]

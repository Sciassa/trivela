"""Pre-2012 and extra sources (SPEC §0.4):

- ewenme/transfers (Transfermarkt scrape, 1992–2022): Serie A transfers with fee → Il Mercato 1992–2011
- salimt/football-datasets transfer_history + profiles (Transfermarkt ids): careers → Il Giramondo; nationality lookup
- StatsBomb Open Data: Champions League finals 1999–2019, Euro 2020/2024, Serie A 1986/87 and 2015/16
- jalapic/engsoccerdata italy.csv: Serie A calendar 1929– → weekday questions before 2012
- jfjelstul/worldcup: managers and awards of every World Cup

Ids: players are "tm:p:<id>" when a Transfermarkt id is known, otherwise "sb:<id>" / "ewn:<name>" /
"wcm:<id>"; generate.unify_ids() maps them onto existing entities by exact name.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import random
import re
import unicodedata
from collections import Counter, defaultdict

import duckdb

from . import http
from .gen_tm import COUNTRY_IT, POS_IT, WEEKDAYS, base, clean_club, date_it, fee_label, opts4, season_label
from .paths import CACHE, SB_RAW

SRC = CACHE / "src"
SALIMT = SRC / "football-datasets" / "datalake" / "transfermarkt"
EWENME = "https://raw.githubusercontent.com/ewenme/transfers/master/data"
JALAPIC = "https://raw.githubusercontent.com/jalapic/engsoccerdata/master/data-raw/italy.csv"
WCDB = "https://raw.githubusercontent.com/jfjelstul/worldcup/master/data-csv"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s).split())


def text(url: str) -> str:
    return http.get(url, expect_json=False, min_interval=0.2)


def rows(url: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text(url))))


# ----------------------------------------------------------------------------- salimt (Transfermarkt ids)

def ensure_salimt() -> bool:
    """Clone the repo (pointer files) and download the LFS files we need from media.githubusercontent.com."""
    import subprocess
    import urllib.request
    root = SRC / "football-datasets"
    if not root.exists():
        SRC.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "-q", "--depth", "1", "https://github.com/salimt/football-datasets", str(root)],
                       check=False, env={"GIT_LFS_SKIP_SMUDGE": "1", "PATH": "/usr/bin:/bin:/usr/local/bin"})
    for rel in ("transfer_history/transfer_history.csv",):
        p = SALIMT / rel
        if p.exists() and p.stat().st_size < 10_000:
            url = f"https://media.githubusercontent.com/media/salimt/football-datasets/main/datalake/transfermarkt/{rel}"
            req = urllib.request.Request(url, headers={"User-Agent": http.USER_AGENT})
            with urllib.request.urlopen(req, timeout=600) as r, open(p, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
    return (SALIMT / "player_profiles" / "player_profiles.csv").exists()


class Salimt:
    def __init__(self):
        self.ok = ensure_salimt()
        self.con = duckdb.connect()
        if not self.ok:
            return
        opt = "quote='\"', escape='\"', header=true, ignore_errors=true"
        self.con.execute(f"create view prof as select * from read_csv('{SALIMT}/player_profiles/player_profiles.csv', {opt})")
        self.con.execute(f"create view th as select * from read_csv('{SALIMT}/transfer_history/transfer_history.csv', {opt})")
        self.con.execute(f"create view mv as select * from read_csv('{SALIMT}/player_market_value/player_market_value.csv', {opt})")
        self.profiles = {}
        for pid_, name, dob, cit, pos in self.con.execute(
                "select player_id, player_name, date_of_birth, citizenship, position from prof").fetchall():
            name = re.sub(r"\s*\(\d+\)\s*$", "", name or "")
            self.profiles[int(pid_)] = (name, dob, cit, pos)
        self.by_name = defaultdict(list)
        for pid_, p in self.profiles.items():
            self.by_name[norm(p[0])].append(pid_)
        self.max_value = {int(a): float(b) for a, b in self.con.execute(
            "select player_id, max(value) from mv group by 1").fetchall() if a is not None and b is not None}

    def find(self, name: str, birth_year: int | None) -> int | None:
        cands = self.by_name.get(norm(name), [])
        if birth_year:
            cands = [c for c in cands if self.profiles[c][1] and abs(int(str(self.profiles[c][1])[:4]) - birth_year) <= 1]
        return cands[0] if len(cands) == 1 else None


# ----------------------------------------------------------------------------- Il Mercato 1992–2011 (ewenme)

def gen_mercato_hist(s: Salimt, notable_fee: float = 10.0) -> list[dict]:
    out, seen = [], set()
    for league in ("serie-a",):
        for r in rows(f"{EWENME}/{league}.csv"):
            try:
                fee = float(r["fee_cleaned"])
                year = int(r["year"])
            except (TypeError, ValueError):
                continue
            if fee <= 0 or year > 2011 or not r["player_name"] or not r["position"]:
                continue
            buyer, seller = (r["club_name"], r["club_involved_name"]) if r["transfer_movement"] == "in" else (r["club_involved_name"], r["club_name"])
            key = (norm(r["player_name"]), year, norm(clean_club(buyer)))
            if key in seen:
                continue
            seen.add(key)
            try:
                byear = year - int(r["age"]) if r["age"] not in ("", "NA") else None
            except ValueError:
                byear = None
            pid_ = s.find(r["player_name"], byear) if s.ok else None
            cit = (s.profiles[pid_][2] if pid_ else None) or ""
            cit = cit.split("  ")[0].split(",")[0].strip() if cit else ""
            if not pid_ or not cit or fee < notable_fee:
                continue  # nationality unknown or below the notoriety threshold
            win = f"Estate {year}" if r["transfer_period"] == "Summer" else f"Inverno {year + 1}"
            clues = [fee_label(fee * 1_000_000), win, POS_IT.get(r["position"], r["position"]), COUNTRY_IT.get(cit, cit),
                     f"Club cedente: {clean_club(seller)}", f"Club acquirente: {clean_club(buyer)}"]
            it = base("ewn_mercato", (pid_, year, buyer), year=year, fame=int(min(150, fee * 2)),
                      entities=["comp:IT1", f"tm:p:{pid_}"],
                      sources=[{"family": "transfermarkt", "label": "Transfermarkt via ewenme/transfers",
                                "url": f"https://github.com/ewenme/transfers/blob/master/data/{league}.csv"}],
                      script=f"{r['player_name']} passò da {clean_club(seller)} a {clean_club(buyer)} ({win.lower()}) per {fee_label(fee * 1_000_000)}.")
            it.update({"clues": clues, "flag": cit, "answer": {"kind": "entity", "ids": [f"tm:p:{pid_}"], "display": r["player_name"]}})
            out.append(it)
    return out


def gen_giramondo_hist(s: Salimt, notable: set[int], limit: int = 800) -> list[dict]:
    if not s.ok:
        return []
    careers = defaultdict(list)
    for pid_, d, to_id, to_name in s.con.execute(
            "select player_id, transfer_date, to_team_id, to_team_name from th where to_team_name is not null order by player_id, transfer_date").fetchall():
        if pid_ is None or d is None:
            continue
        careers[int(pid_)].append((d, to_name))
    out = []
    for pid_, steps in careers.items():
        if pid_ not in notable or pid_ not in s.profiles:
            continue
        clubs = []
        for d, name in steps:
            n = clean_club(name)
            if re.search(r"\b(U\d\d|Youth|Primavera|Retired|Without Club|Career break|Unknown)\b", n, re.I) or n.endswith(" B"):
                continue
            if not clubs or clubs[-1][1] != n:
                clubs.append((d, n))
        if len(clubs) < 5 or clubs[0][0].year >= 2012:
            continue
        picks = clubs[:4] + [clubs[-1]] if len(clubs) > 5 else clubs
        clues = [f"{season_label(c[0].year if c[0].month >= 7 else c[0].year - 1)}: {c[1]}" for c in picks]
        name = s.profiles[pid_][0]
        it = base("sal_giramondo", pid_, year=clubs[0][0].year, year_max=clubs[-1][0].year, fame=90,
                  entities=[f"tm:p:{pid_}"], active=[clubs[-1][0].year],
                  sources=[{"family": "transfermarkt", "label": "Transfermarkt via salimt/football-datasets (storico trasferimenti)",
                            "url": "https://github.com/salimt/football-datasets"}],
                  script=f"La carriera di {name}: " + " → ".join(f"{c[1]} ({c[0].year})" for c in clubs) + ".")
        it.update({"clues": clues, "answer": {"kind": "entity", "ids": [f"tm:p:{pid_}"], "display": name}})
        out.append(it)
    return out[:limit]


# ----------------------------------------------------------------------------- StatsBomb extra competitions

SB_POS = {"Goalkeeper": (0.5, 0.06), "Right Back": (0.85, 0.3), "Left Back": (0.15, 0.3), "Right Center Back": (0.62, 0.24),
          "Left Center Back": (0.38, 0.24), "Center Back": (0.5, 0.24), "Right Wing Back": (0.9, 0.42), "Left Wing Back": (0.1, 0.42),
          "Right Defensive Midfield": (0.62, 0.42), "Left Defensive Midfield": (0.38, 0.42), "Center Defensive Midfield": (0.5, 0.42),
          "Right Center Midfield": (0.65, 0.54), "Left Center Midfield": (0.35, 0.54), "Center Midfield": (0.5, 0.54),
          "Right Midfield": (0.88, 0.56), "Left Midfield": (0.12, 0.56), "Right Attacking Midfield": (0.65, 0.68),
          "Left Attacking Midfield": (0.35, 0.68), "Center Attacking Midfield": (0.5, 0.68), "Right Wing": (0.85, 0.76),
          "Left Wing": (0.15, 0.76), "Right Center Forward": (0.62, 0.86), "Left Center Forward": (0.38, 0.86),
          "Center Forward": (0.5, 0.86), "Secondary Striker": (0.5, 0.8)}
SB_COMPS = {(16, None): "Champions League", (55, None): "Europeo", (12, None): "Serie A"}
TOP_IT = {"AC Milan", "Inter Milan", "Juventus", "Napoli", "Roma", "Lazio", "Fiorentina"}


def sb_name(p: dict) -> str:
    return p.get("player_nickname") or p["player_name"]


def gen_statsbomb(limit_seriea: int = 40) -> dict[str, list[dict]]:
    comps = http.get_json(f"{SB_RAW}/data/competitions.json", min_interval=0.2)
    wanted = [c for c in comps if c["competition_gender"] == "male" and c["competition_id"] in (16, 55, 12)]
    out: dict[str, list[dict]] = defaultdict(list)
    for c in wanted:
        matches = http.get_json(f"{SB_RAW}/data/matches/{c['competition_id']}/{c['season_id']}.json", min_interval=0.2)
        for m in matches:
            home, away = m["home_team"]["home_team_name"], m["away_team"]["away_team_name"]
            stage = (m.get("competition_stage") or {}).get("name", "")
            if c["competition_id"] == 55 and stage == "Group Stage":
                continue
            if c["competition_id"] == 12 and not ({home, away} & TOP_IT and (home in TOP_IT or c["season_name"] == "1986/1987")):
                continue
            comp = SB_COMPS[(c["competition_id"], None)]
            season = c["season_name"]
            d = dt.date.fromisoformat(m["match_date"])
            label = f"{clean_club(home)}-{clean_club(away)} {m['home_score']}-{m['away_score']}"
            ctx = f"{comp} {season}" + (f", {stage.lower()}" if stage and stage != "Regular Season" else "")
            src = [{"family": "statsbomb", "label": f"StatsBomb Open Data: {label}", "url": f"{SB_RAW}/data/events/{m['match_id']}.json"}]
            lu = http.get_json(f"{SB_RAW}/data/lineups/{m['match_id']}.json", min_interval=0.2)
            ev = http.get_json(f"{SB_RAW}/data/events/{m['match_id']}.json", min_interval=0.2)
            names = {p["player_id"]: sb_name(p) for t in lu for p in t["lineup"]}
            goals = []
            for e in ev:
                tn = e["type"]["name"]
                if tn == "Shot" and e.get("shot", {}).get("outcome", {}).get("name") == "Goal" and e.get("period", 0) <= 4:
                    goals.append((e["minute"] + 1, e["team"]["name"], e["player"]["id"], False))
                elif tn == "Own Goal Against":
                    other = away if e["team"]["name"] == home else home
                    goals.append((e["minute"] + 1, other, e["player"]["id"], True))
            goals.sort()
            if len(goals) != m["home_score"] + m["away_score"]:
                continue
            ents = [f"comp:{'CL' if c['competition_id'] == 16 else 'EURO' if c['competition_id'] == 55 else 'IT1'}"] + [f"sb:{g[2]}" for g in goals]
            ans = lambda pid_: {"kind": "entity", "ids": [f"sb:{pid_}"], "display": names.get(pid_, "?")}  # noqa: E731
            # formazione
            teams = []
            for t in lu:
                starters = [p for p in t["lineup"] if p["positions"] and p["positions"][0].get("start_reason") == "Starting XI"]
                if len(starters) != 11 or any(p["positions"][0]["position"] not in SB_POS for p in starters):
                    break
                r = random.Random(f"{m['match_id']}-{t['team_id']}")
                hidden = set(r.sample([p["player_id"] for p in starters if p["positions"][0]["position"] != "Goalkeeper"], 5))
                teams.append({"id": f"sbteam:{t['team_id']}", "name": clean_club(t["team_name"]), "formation": "",
                              "players": [{"id": f"sb:{p['player_id']}", "name": sb_name(p), "number": p.get("jersey_number"),
                                           "x": SB_POS[p["positions"][0]["position"]][0], "y": SB_POS[p["positions"][0]["position"]][1],
                                           "hidden": p["player_id"] in hidden} for p in starters]})
            if len(teams) == 2:
                it = base("sb_formazione", m["match_id"], year=d.year, fame=90, entities=ents + [pp["id"] for tt in teams for pp in tt["players"]],
                          sources=src, script=f"Titolari di {label} ({ctx}, {date_it(d)}) secondo StatsBomb.")
                it.update({"title": label, "date": date_it(d), "competition": ctx, "teams": teams})
                out["formazione"].append(it)
            # frame + cassaforte + prima pagina
            if len(goals) >= 2:
                mins = [g[0] for g in goals]
                cands = [x for x in range(5, 86) if x not in (44, 45, 46, 47) and all(abs(x - y) >= 2 for y in mins) and any(y < x for y in mins)]
                if cands:
                    x = random.Random(m["match_id"]).choice(cands)
                    before = [g for g in goals if g[0] < x]
                    sc = [sum(1 for g in before if g[1] == home), sum(1 for g in before if g[1] == away)]
                    it = base("sb_frame", (m["match_id"], x), year=d.year, fame=90, entities=ents, sources=src,
                              script=f"{label} ({ctx}): al {x}' era {sc[0]}-{sc[1]}. Gol: " + ", ".join(f"{g[0]}' {names.get(g[2])}" for g in goals) + ".")
                    it.update({"match": f"{clean_club(home)}-{clean_club(away)} ({ctx})", "date": date_it(d), "minute": x,
                               "teams": [clean_club(home), clean_club(away)], "scoreAt": sc})
                    if not before[-1][3]:
                        it["lastScorer"] = ans(before[-1][2])
                    out["frame"].append(it)
            for g in goals:
                if g[3]:
                    continue
                it = base("sb_cf_scorer", (m["match_id"], g[2], g[0]), year=d.year, fame=90, entities=ents, sources=src,
                          script=f"Al {g[0]}' di {label} ({ctx}) segnò {names.get(g[2])}.")
                it.update({"level": 2, "question": f"Chi segnò al {g[0]}' di {label} ({ctx})?", "parts": [ans(g[2])]})
                out["cassaforte"].append(it)
    return dict(out)


# ----------------------------------------------------------------------------- Serie A calendar 1929– (jalapic)

BIG_J = {"Juventus": "Juventus", "Inter": "Inter", "AC Milan": "Milan", "AS Roma": "Roma", "Lazio Roma": "Lazio", "SSC Napoli": "Napoli",
         "ACF Fiorentina": "Fiorentina", "Torino FC": "Torino", "Bologna FC": "Bologna"}


def gen_calendar() -> list[dict]:
    data = rows(JALAPIC)
    src = {"family": "engsoccerdata", "label": "engsoccerdata: Serie A 1929–", "url": "https://github.com/jalapic/engsoccerdata"}
    by = defaultdict(list)
    for r in data:
        if r["tier"] != "1":
            continue
        season = int(r["Season"])
        if season >= 2012:
            continue  # covered by Transfermarkt
        for side in ("home", "visitor"):
            if r[side] in BIG_J:
                by[(season, BIG_J[r[side]])].append(r)
    out = []
    for (season, club), games in by.items():
        if len(games) < 20:
            continue
        wd = Counter(dt.date.fromisoformat(g["Date"]).weekday() for g in games)
        for day, n in wd.items():
            if n != 1 or day == 6:
                continue
            g = next(x for x in games if dt.date.fromisoformat(x["Date"]).weekday() == day)
            lab = lambda x: f"{BIG_J.get(x['home'], clean_club(x['home']))}-{BIG_J.get(x['visitor'], clean_club(x['visitor']))} {x['FT']}"  # noqa: E731
            o = opts4(lab(g), [lab(x) for x in games], f"cal-{season}-{club}-{day}")
            if not o:
                continue
            d = dt.date.fromisoformat(g["Date"])
            it = base("cal_weekday", (season, club, day), year=season, fame=70, entities=["comp:IT1", f"club:{club}"], sources=[src],
                      script=f"Nella Serie A {season_label(season)} il club {club} giocò di {WEEKDAYS[day]} solo {lab(g)}, il {date_it(d)}.")
            it.update({"question": f"Quale fu l'unica partita della Serie A {season_label(season)} che il club {club} giocò di {WEEKDAYS[day]}?",
                       "options": o[0], "correct": o[1], "archetype": 1})
            out.append(it)
    return out


# ----------------------------------------------------------------------------- World Cup managers and awards (jfjelstul)

AWARD_IT = {"Golden Ball": "il Pallone d'oro del Mondiale", "Golden Boot": "la Scarpa d'oro del Mondiale",
            "Golden Glove": "il Guanto d'oro del Mondiale", "Best Young Player Award": "il premio di miglior giovane del Mondiale"}


def gen_wc_people() -> dict[str, list[dict]]:
    src = {"family": "fjelstul", "label": "Fjelstul World Cup Database", "url": "https://github.com/jfjelstul/worldcup"}
    apps = [r for r in rows(f"{WCDB}/manager_appointments.csv") if "Men's" in r["tournament_name"]]
    out: dict[str, list[dict]] = defaultdict(list)
    by_t = defaultdict(list)
    for r in apps:
        by_t[r["tournament_id"]].append(r)
    for tid, lst in by_t.items():
        year = int(tid.split("-")[1])
        names = [f"{r['given_name']} {r['family_name']}".strip() for r in lst if r["given_name"] != "not applicable"]
        for r in lst:
            if r["given_name"] == "not applicable":
                continue
            name = f"{r['given_name']} {r['family_name']}"
            team = COUNTRY_IT.get(r["team_name"], r["team_name"])
            o = opts4(name, names, f"ct-{tid}-{r['team_code']}")
            if not o:
                continue
            it = base("wc_manager", (tid, r["team_code"]), year=year, fame=60, entities=["wc", f"wc:{year}", f"wcm:{r['manager_id']}"], sources=[src],
                      script=f"Al Mondiale {year} il commissario tecnico della nazionale {team} era {name}.")
            it.update({"question": f"Chi era il commissario tecnico della nazionale {team} al Mondiale {year}?",
                       "options": o[0], "correct": o[1], "archetype": 3})
            out["tiro_secco"].append(it)
    aw = [r for r in rows(f"{WCDB}/award_winners.csv") if "Men's" in r["tournament_name"] and r["award_name"] in AWARD_IT and r["shared"] == "0"]
    for r in aw:
        year = int(r["tournament_id"].split("-")[1])
        name = f"{r['given_name']} {r['family_name']}".replace("not applicable ", "").strip()
        it = base("wc_award", (r["tournament_id"], r["award_name"]), year=year, fame=120, entities=["wc", f"wc:{year}", f"wcp:{r['player_id']}"],
                  sources=[src], script=f"{name} ({COUNTRY_IT.get(r['team_name'], r['team_name'])}) vinse {AWARD_IT[r['award_name']]} {year}.")
        it.update({"level": 1 if r["award_name"] == "Golden Ball" else 2,
                   "question": f"Chi vinse {AWARD_IT[r['award_name']]} {year}?",
                   "parts": [{"kind": "entity", "ids": [f"wcp:{r['player_id']}"], "display": name}]})
        out["cassaforte"].append(it)
    return dict(out)


def hist_entities(packs: dict[str, list[dict]]) -> list[dict]:
    """Person entities for ids introduced here (names taken from the items themselves)."""
    seen: dict[str, str] = {}

    def walk(x):
        if isinstance(x, dict):
            if x.get("kind") == "entity":
                for i in x.get("ids", []):
                    seen.setdefault(i, x.get("display", ""))
            if "id" in x and "name" in x and isinstance(x["id"], str) and x["id"].startswith(("sb:", "tm:p:")):
                seen.setdefault(x["id"], x["name"])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(packs)
    return [{"id": i, "kind": "person", "name": n, "fame": 30, "aliases": []}
            for i, n in seen.items() if n and i.split(":")[0] in ("sb", "wcp", "tm")]


def generate_hist(notable_tm: set[int]) -> dict[str, list[dict]]:
    s = Salimt()
    out: dict[str, list[dict]] = defaultdict(list)
    out["mercato"] += gen_mercato_hist(s)
    out["giramondo"] += gen_giramondo_hist(s, notable_tm | {pid_ for pid_, v in s.max_value.items() if v >= 10_000_000} if s.ok else set())
    for k, v in gen_statsbomb().items():
        out[k] += v
    out["tiro_secco"] += gen_calendar()
    for k, v in gen_wc_people().items():
        out[k] += v
    return dict(out)


if __name__ == "__main__":
    p = generate_hist(set())
    print(json.dumps({k: len(v) for k, v in p.items()}, indent=2))

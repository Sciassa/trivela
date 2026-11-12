"""National teams 1872-today (martj42/international_results, CC0) and the 2026/27 delta (open-matchday).

Both are downloaded fresh on every sync run (no permanent cache) so the packs follow the season.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import random
import urllib.request
from collections import Counter, defaultdict

from . import http
from .gen_tm import COUNTRY_IT, WEEKDAYS, base, date_it, opts4
from .paths import CACHE

INTL = "https://raw.githubusercontent.com/martj42/international_results/master"
MATCHDAY = "https://cdn.jsdelivr.net/gh/oladeeayo/open-matchday@master/data"
DELTA_DIR = CACHE / "delta"
EXTRA_IT = {"West Germany": "Germania Ovest", "Soviet Union": "Unione Sovietica", "Yugoslavia": "Jugoslavia",
            "Czechoslovakia": "Cecoslovacchia", "East Germany": "Germania Est", "Republic of Ireland": "Irlanda",
            "Faroe Islands": "Isole Fær Øer", "San Marino": "San Marino", "Liechtenstein": "Liechtenstein",
            "Andorra": "Andorra", "Gibraltar": "Gibilterra", "Luxembourg": "Lussemburgo", "Malta": "Malta",
            "Cyprus": "Cipro", "Estonia": "Estonia", "Lithuania": "Lituania", "Latvia": "Lettonia", "Moldova": "Moldavia",
            "Turkey": "Turchia", "United States": "Stati Uniti", "Egypt": "Egitto", "Israel": "Israele"}


def it_name(team: str) -> str:
    return EXTRA_IT.get(team) or COUNTRY_IT.get(team) or team


def fetch_fresh(url: str, name: str) -> str:
    """Download without the permanent HTTP cache (delta data changes every day); keep a local copy."""
    DELTA_DIR.mkdir(parents=True, exist_ok=True)
    path = DELTA_DIR / name
    try:
        req = urllib.request.Request(url, headers={"User-Agent": http.USER_AGENT})
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode("utf-8")
        path.write_text(text, encoding="utf-8")
        return text
    except Exception as e:  # noqa: BLE001 - offline runs reuse the last copy
        if path.exists():
            print(f"[delta] {name}: using cached copy ({e})", flush=True)
            return path.read_text(encoding="utf-8")
        raise


def rows(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text)))


SRC_INTL = {"family": "martj42", "label": "International football results 1872– (martj42)",
            "url": "https://github.com/martj42/international_results"}


def gen_intl(team: str = "Italy") -> dict[str, list[dict]]:
    res = rows(fetch_fresh(f"{INTL}/results.csv", "results.csv"))
    gs = rows(fetch_fresh(f"{INTL}/goalscorers.csv", "goalscorers.csv"))
    last_date = max(r["date"] for r in res if r["home_score"] not in ("", "NA"))
    out: dict[str, list[dict]] = defaultdict(list)
    tname = it_name(team)
    # opponents faced most often without ever losing
    rec = defaultdict(lambda: [0, 0, 0, 0])  # played, won, drawn, lost
    first = {}
    for r in res:
        if team not in (r["home_team"], r["away_team"]) or r["home_score"] in ("", "NA"):
            continue
        opp = r["away_team"] if r["home_team"] == team else r["home_team"]
        hs, as_ = int(r["home_score"]), int(r["away_score"])
        mine, theirs = (hs, as_) if r["home_team"] == team else (as_, hs)
        rr = rec[opp]
        rr[0] += 1
        rr[1 if mine > theirs else 2 if mine == theirs else 3] += 1
        first.setdefault(opp, r["date"])
    unbeaten = sorted(((o, v) for o, v in rec.items() if v[3] == 0), key=lambda x: -x[1][0])
    if len(unbeaten) >= 10:
        tenth = unbeaten[9][1][0]
        ranking = []
        for o, v in unbeaten:
            rank = sum(1 for _o, v2 in unbeaten if v2[0] > v[0]) + 1
            if rank > 10:
                break
            ranking.append({"rank": 10 if v[0] == tenth else rank, "id": f"intl:{o}", "name": it_name(o), "value": v[0]})
        if len([r for r in ranking if r["rank"] == 10]) <= 6:
            it = base("intl_unbeaten", team, year=1910, year_max=int(last_date[:4]), fame=150, entities=["intl:" + team],
                      sources=[SRC_INTL], script="In testa: " + ", ".join(f"{r['name']} ({r['value']} sfide)" for r in ranking[:3]) + ".")
            it.update({"title": f"Le 10 nazionali affrontate più volte dall'{tname} senza mai perdere",
                       "definition": f"Tutte le partite ufficiali e amichevoli della nazionale maggiore fino al {last_date}; i pareggi non sono sconfitte",
                       "unit": "partite", "ranking": ranking, "snapshot": last_date})
            out["dischetto"].append(it)
    # (top scorers are not generated: goalscorers.csv is incomplete for early decades)
    # first meeting year
    for opp, v in rec.items():
        if v[0] < 8:
            continue
        y = int(first[opp][:4])
        decoys = [str(y + d) for d in (-12, -8, 7, 11, 15, -20) if 1900 < y + d <= int(last_date[:4])]
        o = opts4(str(y), decoys, f"first-{opp}")
        if not o:
            continue
        it = base("intl_first_meeting", opp, year=y, fame=80, entities=["intl:" + team, "intl:" + opp], sources=[SRC_INTL],
                  script=f"La prima sfida tra {tname} e {it_name(opp)} risale al {first[opp]}; in totale {v[0]} partite ({v[1]} vittorie, {v[2]} pareggi, {v[3]} sconfitte).")
        it.update({"question": f"In che anno l'{tname} affrontò per la prima volta la nazionale {it_name(opp)}?",
                   "options": o[0], "correct": o[1], "archetype": 1})
        out["tiro_secco"].append(it)
    return dict(out)


TEAM_FIX = {"Internazionale": "Inter", "AC Milan": "Milan", "Roma": "Roma"}


def gen_delta(folder: str = "ITA_1_serie-a", label: str = "Serie A 2026/27") -> dict[str, list[dict]]:
    url = f"{MATCHDAY}/{folder}/results_2627.csv"
    text = fetch_fresh(url, f"{folder}_2627.csv")
    data = [r for r in rows(text) if r.get("ft_home") not in ("", None)]
    if not data:
        return {}
    upto = max(r["date"] for r in data)
    src = {"family": "open-matchday", "label": f"open-matchday: {label} (aggiornato al {upto})", "url": f"https://github.com/oladeeayo/open-matchday/tree/master/data/{folder}"}
    team = lambda x: TEAM_FIX.get(x, x)  # noqa: E731
    out: dict[str, list[dict]] = defaultdict(list)
    by_team = defaultdict(list)
    for r in data:
        by_team[team(r["home"])].append(r)
        by_team[team(r["away"])].append(r)
        h, a = int(r["ft_home"]), int(r["ft_away"])
        score = f"{h}-{a}"
        decoys = [f"{x}-{y}" for x, y in ((h + 1, a), (h, a + 1), (a, h), (h + 1, a + 1), (max(0, h - 1), a))]
        o = opts4(score, decoys, f"delta-{folder}-{r['date']}-{r['home']}")
        if not o:
            continue
        d = dt.date.fromisoformat(r["date"])
        it = base("delta_result", (folder, r["date"], r["home"], r["away"]), year=d.year, fame=60,
                  entities=[f"delta:{team(r['home'])}", f"delta:{team(r['away'])}"], sources=[src],
                  script=f"{team(r['home'])}-{team(r['away'])} ({label}, {date_it(d)}) finì {score}; primo tempo {r['ht_home']}-{r['ht_away']}.")
        it.update({"question": f"Come finì {team(r['home'])}-{team(r['away'])} del {date_it(d)} ({label})?",
                   "options": o[0], "correct": o[1], "archetype": 2})
        out["tiro_secco"].append(it)
    # unique weekday so far
    for tm_name, games in by_team.items():
        wd = Counter(dt.date.fromisoformat(g["date"]).weekday() for g in games)
        for day, n in wd.items():
            if n != 1 or day in (5, 6) or len(games) < 6:
                continue
            g = next(x for x in games if dt.date.fromisoformat(x["date"]).weekday() == day)
            lab = lambda x: f"{team(x['home'])}-{team(x['away'])} {x['ft_home']}-{x['ft_away']}"  # noqa: E731
            o = opts4(lab(g), [lab(x) for x in games], f"delta-wd-{tm_name}-{day}")
            if not o:
                continue
            it = base("delta_weekday", (folder, tm_name, day, upto), year=int(upto[:4]), fame=60, entities=[f"delta:{tm_name}"],
                      sources=[src], script=f"Fino al {upto} la squadra {tm_name} ha giocato di {WEEKDAYS[day]} solo {lab(g)}.")
            it.update({"question": f"{label}, fino al {date_it(dt.date.fromisoformat(upto))}: qual è l'unica partita che {tm_name} ha giocato di {WEEKDAYS[day]}?",
                       "options": o[0], "correct": o[1], "archetype": 1})
            out["tiro_secco"].append(it)
    return dict(out)


def delta_all() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for folder, label in (("ITA_1_serie-a", "Serie A 2026/27"), ("UEFA_1_champions-league", "Champions League 2026/27")):
        try:
            for k, v in gen_delta(folder, label).items():
                out[k] += v
        except Exception as e:  # noqa: BLE001
            print(f"[delta] {folder} skipped: {e}", flush=True)
    for k, v in gen_intl().items():
        out[k] += v
    return dict(out)


def intl_entities() -> list[dict]:
    res = rows((DELTA_DIR / "results.csv").read_text(encoding="utf-8"))
    teams = {r["home_team"] for r in res} | {r["away_team"] for r in res}
    ents = [{"id": f"intl:{t}", "kind": "nation", "name": it_name(t), "fame": 40, "aliases": sorted({t} - {it_name(t)})} for t in teams]
    gs = rows((DELTA_DIR / "goalscorers.csv").read_text(encoding="utf-8"))
    for name in {g["scorer"] for g in gs if g["scorer"] not in ("", "NA")}:
        ents.append({"id": f"intlp:{name}", "kind": "person", "name": name, "fame": 5, "aliases": []})
    return ents


__all__ = ["delta_all", "intl_entities", "random"]

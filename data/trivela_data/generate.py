"""Generate question packs from the verified graph (build/graph.json).

Every instance uses only facts confirmed by at least two source families and
carries the sources. Sets and rankings are produced only where the underlying
data is complete (all matches/squads of the scope verified), so that a correct
answer can never be rejected.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import random
from collections import Counter, defaultdict
from itertools import combinations

from . import http
from .fetch import wc_pages
from .italian import NATIONS, POSITIONS, WEEKDAYS, date_it, prep, round_it
from .openfootball import load_matches
from .paths import BUILD, PACKS_OUT, WC_YEARS
from .text import norm, strip_disambiguation
from .validate_content import load_published
from .wiki import parse_squads

HOSTS = {
    1930: ["Uruguay"], 1934: ["Italia"], 1938: ["Francia"], 1950: ["Brasile"], 1954: ["Svizzera"], 1958: ["Svezia"],
    1962: ["Cile"], 1966: ["Inghilterra"], 1970: ["Messico"], 1974: ["Germania Ovest"], 1978: ["Argentina"],
    1982: ["Spagna"], 1986: ["Messico"], 1990: ["Italia"], 1994: ["Stati Uniti", "USA"], 1998: ["Francia"],
    2002: ["Corea e Giappone", "Corea del Sud e Giappone"], 2006: ["Germania"], 2010: ["Sudafrica"], 2014: ["Brasile"],
    2018: ["Russia"], 2022: ["Qatar"], 2026: ["Stati Uniti, Canada e Messico", "Nord America"],
}

FAMILY_LABELS = {
    "openfootball": ("openfootball (World Cup)", "https://github.com/openfootball/worldcup.json", "Public Domain (CC0)"),
    "wikimedia": ("Wikipedia (en) e Wikidata", "https://www.wikipedia.org", "CC BY-SA 4.0 / CC0"),
    "statsbomb": ("StatsBomb Open Data", "https://github.com/statsbomb/open-data", "StatsBomb Open Data licence (attribuzione)"),
    "transfermarkt": ("Transfermarkt (dataset dcaribou/transfermarkt-datasets, storico fino a luglio 2026)",
                      "https://github.com/dcaribou/transfermarkt-datasets", "Dati © Transfermarkt; dataset CC0"),
    "martj42": ("International football results 1872– (martj42)", "https://github.com/martj42/international_results", "CC0"),
    "open-matchday": ("open-matchday (stagione 2026/27, aggiornato ogni giorno)", "https://github.com/oladeeayo/open-matchday",
                      "Uso non commerciale con attribuzione"),
}

rng = random.Random(20261111)


def iid(*parts) -> str:
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12]


class G:
    """Lookup helpers over graph.json."""

    def __init__(self, graph: dict):
        self.g = graph
        self.qids: dict[str, str] = graph["qids"]
        self.people: dict[str, dict] = graph["people"]
        self.places: dict[str, dict] = graph["places"]
        self.matches = [m for ed in graph["editions"] for m in ed["matches"]]
        self.squads = [s for ed in graph["editions"] for s in ed["squads"]]

    def qid(self, title: str | None) -> str | None:
        return self.qids.get(title) if title else None

    def pname(self, title: str) -> str:
        q = self.qid(title)
        p = self.people.get(q or "", {})
        return p.get("it") or p.get("en") or strip_disambiguation(title)

    def family(self, title: str) -> str:
        q = self.qid(title)
        p = self.people.get(q or "", {})
        fam = p.get("family")
        name = self.pname(title)
        if fam and norm(fam) in norm(name):
            return fam
        return name.split()[-1] if " " in name else name

    def fame(self, title: str) -> int:
        q = self.qid(title)
        return int(self.people.get(q or "", {}).get("sitelinks") or self.places.get(q or "", {}).get("sitelinks") or 0)

    def club(self, title: str) -> str:
        """Common club name as linked on Wikipedia squad lists (e.g. "Werder Bremen")."""
        if not hasattr(self, "_club_labels"):
            labels: dict[str, Counter] = defaultdict(Counter)
            for s in self.squads:
                if s.get("club") and s.get("club_label"):
                    labels[s["club"]][s["club_label"]] += 1
            self._club_labels = {t: c.most_common(1)[0][0] for t, c in labels.items()}
        return self._club_labels.get(title) or strip_disambiguation(title)

    def place(self, title: str) -> str:
        q = self.qid(title)
        p = self.places.get(q or "", {})
        return p.get("it") or p.get("en") or strip_disambiguation(title)


def nation(code: str) -> str:
    return NATIONS.get(code, code)


def difficulty(fame: int) -> int:
    return 1 if fame >= 60 else 2 if fame >= 25 else 3


def pid(g: G, title: str) -> str:
    return g.qid(title) or f"wp:{title}"


def match_label(m: dict) -> str:
    a, b = m["codes"]
    s = m["verified"].get("score")
    base = f"{nation(a)}-{nation(b)}"
    return f"{base} {s[0]}-{s[1]}" if s else base


def goal_str(g: G, goal: dict) -> str:
    minute = f"{goal['minute']}+{goal['extra']}" if goal["extra"] else str(goal["minute"])
    tags = " (rig.)" if goal["penalty"] else ""
    tags = " (aut.)" if goal["own_goal"] else tags
    return f"{minute}' {g.family(goal['title'])}{tags}"


def ed_entities(year: int) -> list[str]:
    return ["wc", f"wc:{year}"]


def base(gen: str, params, *, year: int, fame: int, entities: list[str], sources: list[dict], script: str,
         active: list[int] | None = None, year_max: int | None = None) -> dict:
    d = {
        "id": iid(gen, params),
        "generator": gen,
        "yearMin": year,
        "yearMax": year_max or year,
        "difficulty": difficulty(fame),
        "fame": fame,
        "entities": sorted(set(entities)),
        "sources": dedupe_sources(sources),
        "script": script,
    }
    if active:
        d["activeYears"] = active
    return d


def dedupe_sources(srcs: list[dict]) -> list[dict]:
    seen, out = set(), []
    for s in srcs:
        if s["url"] in seen:
            continue
        seen.add(s["url"])
        out.append(s)
    return out


def person_answer(g: G, title: str) -> dict:
    return {"kind": "entity", "ids": [pid(g, title)], "display": g.pname(title)}


# --------------------------------------------------------------------------- completeness

def completeness(g: G) -> tuple[set[tuple[int, str]], set[tuple[int, str]], dict[str, bool]]:
    """(year, code) with every match goals-complete; (year, code) squads fully verified with club; per-nation goal completeness."""
    verified_by_ed = defaultdict(list)
    for m in g.matches:
        for c in m["codes"]:
            verified_by_ed[(m["year"], c)].append(m)
    total_by_ed: Counter = Counter()
    codes = g.g["codes"]
    for y in WC_YEARS:
        for om in load_matches(y):
            for name in (om.team1, om.team2):
                c = codes.get(norm(name))
                if c:
                    total_by_ed[(y, c)] += 1
    goals_ok = set()
    for key, n in total_by_ed.items():
        ms = verified_by_ed.get(key, [])
        if len(ms) == n and all(m["verified"].get("scorers_complete") for m in ms):
            goals_ok.add(key)
    nation_ok: dict[str, bool] = {}
    for (y, c), _n in total_by_ed.items():
        nation_ok[c] = nation_ok.get(c, True) and (y, c) in goals_ok
    # squads: compare verified-with-club entries against all WP squad entries
    squad_ok = set()
    by_key = defaultdict(list)
    for s in g.squads:
        by_key[(s["year"], s["code"])].append(s)
    for (y, c), facts in by_key.items():
        title = f"{y} FIFA World Cup squads"
        wsq = parse_squads(http.wp_wikitext([title]).get(title, ""))
        wp_titles = {p.title for p in wsq}
        mine = {f["title"] for f in facts}
        # all WP players of this team must be verified members with club
        team_titles = {p.title for p in wsq if p.title in mine}
        if team_titles == mine and all(f.get("club") for f in facts) and len(facts) >= 11 and mine <= wp_titles:
            # make sure no WP entry of the same team heading is missing
            heads = Counter(p.team for p in wsq if p.title in mine)
            if heads:
                head = heads.most_common(1)[0][0]
                if {p.title for p in wsq if p.team == head} == mine:
                    squad_ok.add((y, c))
    return goals_ok, squad_ok, nation_ok


# --------------------------------------------------------------------------- generators

def gen_maglia(g: G) -> list[dict]:
    out = []
    for s in g.squads:
        if s.get("number") is None or len({x["family"] for x in s["sources"]}) < 2:
            continue
        fame = g.fame(s["title"])
        if fame < 8:
            continue
        club = f" (club di appartenenza: {g.club(s['club'])})" if s.get("club") else ""
        script = f"{g.pname(s['title'])} indossò la maglia numero {s['number']} {prep('di', s['code'])} al Mondiale {s['year']}{club}."
        it = base("maglia", (s["year"], s["code"], s["number"]), year=s["year"], fame=fame,
                  entities=ed_entities(s["year"]) + [f"nat:{s['code']}", pid(g, s["title"])], sources=s["sources"], script=script)
        it.update({"team": nation(s["code"]), "season": f"Mondiale {s['year']}", "number": s["number"],
                   "answer": person_answer(g, s["title"])})
        out.append(it)
    out.sort(key=lambda x: -x["fame"])
    return out[:2500]


def is_famous_match(g: G, m: dict) -> bool:
    v = m["verified"]
    r = round_it(m["round"])
    s = v.get("score") or [0, 0]
    return r != "Fase a gironi" or "ITA" in m["codes"] or sum(s) >= 4


def gen_frame(g: G) -> list[dict]:
    out = []
    for m in g.matches:
        v = m["verified"]
        if not v.get("goals_complete") or not v.get("score") or len(v["goals"]) < 2 or not is_famous_match(g, m):
            continue
        goals = v["goals"]
        mins = [x["minute"] for x in goals]
        cands = [t for t in range(5, 89) if t not in (45, 46) and all(abs(t - mm) >= 2 for mm in mins)
                 and any((x["minute"], x["extra"]) < (t, 0) for x in goals)]
        if not cands:
            continue
        t = random.Random(m["id"]).choice(cands)
        before = [x for x in goals if (x["minute"], x["extra"]) < (t, 0)]
        sc = [sum(1 for x in before if x["side"] == 0), sum(1 for x in before if x["side"] == 1)]
        last = before[-1]
        a, b = m["codes"]
        lst = ", ".join(goal_str(g, x) + f" ({nation(m['codes'][x['side']])})" for x in goals)
        script = (f"{nation(a)}-{nation(b)}, {round_it(m['round']).lower()} del Mondiale {m['year']} ({date_it(m['date'])}). "
                  f"Al {t}' il punteggio era {sc[0]}-{sc[1]}. Gol: {lst}. Finale: {v['score'][0]}-{v['score'][1]}"
                  f"{' dopo i supplementari' if v.get('aet') else ''}.")
        fame = max(g.fame(x["title"]) for x in goals)
        it = base("frame", (m["id"], t), year=m["year"], fame=fame,
                  entities=ed_entities(m["year"]) + [f"nat:{a}", f"nat:{b}"] + [pid(g, x["title"]) for x in goals],
                  sources=m["sources"], script=script)
        it.update({"match": f"{nation(a)}-{nation(b)} (Mondiale {m['year']}, {round_it(m['round'])})",
                   "date": date_it(m["date"]), "minute": t, "teams": [nation(a), nation(b)], "scoreAt": sc})
        if not last["own_goal"]:
            it["lastScorer"] = person_answer(g, last["title"])
        out.append(it)
    return out


def gen_mappamondo(g: G) -> list[dict]:
    out = []
    for m in g.matches:
        v = m["verified"]
        city = v.get("city")
        q = g.qid(city)
        coord = g.places.get(q or "", {}).get("coord")
        if not city or not coord or not is_famous_match(g, m):
            continue
        a, b = m["codes"]
        label = g.place(city)
        stadium = f" ({g.place(v['stadium'])})" if v.get("stadium") else ""
        script = f"{match_label(m)}, Mondiale {m['year']}, si giocò a {label}{stadium} il {date_it(m['date'])}."
        it = base("mappamondo", m["id"], year=m["year"], fame=g.fame(city),
                  entities=ed_entities(m["year"]) + [f"nat:{a}", f"nat:{b}", q or city], sources=m["sources"], script=script)
        it.update({"question": f"Dove si giocò {match_label(m)} ({round_it(m['round']).lower()}, Mondiale {m['year']})?",
                   "target": {"lat": coord[0], "lon": coord[1], "label": label}})
        out.append(it)
    return out


LINE_Y = {"GK": 0.07, "DF": 0.3, "MF": 0.56, "FW": 0.82}


def gen_formazione(g: G) -> list[dict]:
    pos = {(s["year"], s["code"], s["title"]): s for s in g.squads}
    out = []
    for m in g.matches:
        v = m["verified"]
        lus = v.get("lineups") or [None, None]
        if not lus[0] or not lus[1] or not v.get("score") or not is_famous_match(g, m):
            continue
        teams = []
        ok = True
        for side in (0, 1):
            code = m["codes"][side]
            players = []
            for p in lus[side]:
                sq = pos.get((m["year"], code, p["title"]))
                if not sq or not sq.get("pos"):
                    ok = False
                    break
                players.append((p, sq))
            if not ok:
                break
            lines = defaultdict(list)
            for p, sq in players:
                lines[sq["pos"]].append((p, sq))
            r = random.Random(f"{m['id']}-{side}")
            outfield = [p["title"] for p, sq in players if sq["pos"] != "GK"]
            hidden = set(r.sample(outfield, 5)) if len(outfield) >= 5 else set()
            plist = []
            for line, members in lines.items():
                for k, (p, sq) in enumerate(members):
                    plist.append({"id": pid(g, p["title"]), "name": g.pname(p["title"]), "number": sq.get("number"),
                                  "x": (k + 1) / (len(members) + 1), "y": LINE_Y.get(line, 0.5), "hidden": p["title"] in hidden})
            teams.append({"id": f"nat:{code}", "name": nation(code), "formation": "", "players": plist})
        if not ok or len(teams) != 2:
            continue
        a, b = m["codes"]
        fame = sum(g.fame(p["title"]) for lu in lus for p in lu) // 22
        script = (f"Le formazioni titolari di {match_label(m)} ({round_it(m['round']).lower()}, Mondiale {m['year']}, "
                  f"{date_it(m['date'])}) sono confermate da due fonti indipendenti; i ruoli sono quelli delle rose ufficiali.")
        it = base("formazione", m["id"], year=m["year"], fame=fame,
                  entities=ed_entities(m["year"]) + [f"nat:{a}", f"nat:{b}"] + [pid(g, p["title"]) for lu in lus for p in lu],
                  sources=m["sources"], script=script)
        it.update({"title": match_label(m), "date": date_it(m["date"]),
                   "competition": f"Mondiale {m['year']} · {round_it(m['round'])}", "teams": teams})
        out.append(it)
    return out


def gen_prima_pagina(g: G) -> list[dict]:
    out = []
    for m in g.matches:
        v = m["verified"]
        if not v.get("goals_complete") or not v.get("score") or not v.get("city"):
            continue
        scorers = [x for x in v["goals"] if not x["own_goal"]]
        if not scorers:
            continue
        a, b = m["codes"]
        r = random.Random(m["id"])
        hidden_goal = r.choice(scorers)
        second_kind = r.choice([k for k in ("city", "referee", "stadium") if v.get(k)])
        s0 = {"label": "Marcatore", "answer": person_answer(g, hidden_goal["title"]),
              "lengthBucket": 1 if len(g.pname(hidden_goal["title"])) < 9 else 2 if len(g.pname(hidden_goal["title"])) < 16 else 3}
        if second_kind == "referee":
            s1 = {"label": "Arbitro", "answer": person_answer(g, v["referee"])}
            hide1 = g.pname(v["referee"])
        elif second_kind == "stadium":
            nm = g.place(v["stadium"])
            s1 = {"label": "Stadio", "answer": {"kind": "text", "accepted": [strip_disambiguation(v["stadium"]), nm], "display": nm}}
            hide1 = nm
        else:
            nm = g.place(v["city"])
            q = g.qid(v["city"])
            s1 = {"label": "Città", "answer": {"kind": "entity", "ids": [q], "display": nm} if q else
                  {"kind": "text", "accepted": [nm], "display": nm}}
            hide1 = nm
        s1["lengthBucket"] = 1 if len(hide1) < 9 else 2 if len(hide1) < 16 else 3
        hide0 = hidden_goal["title"]

        def fam(title: str) -> str:
            return "{{0}}" if title == hide0 else g.family(title)

        def place_txt(title: str | None) -> str:
            if not title:
                return ""
            nm = g.place(title)
            return "{{1}}" if nm == hide1 else nm

        sa, sb = v["score"]
        ta, tb = nation(a), nation(b)
        head = (f"{ta} batte {tb} {sa}-{sb}" if sa > sb else f"{tb} batte {ta} {sb}-{sa}" if sb > sa else f"{ta}-{tb} {sa}-{sb}")
        if v.get("pens"):
            head = f"{ta}-{tb}, decidono i rigori"
        goals_txt = ", ".join(
            (f"{x['minute']}{'+' + str(x['extra']) if x['extra'] else ''}' "
             f"{fam(x['title'])}{' rig.' if x['penalty'] else ''}{' aut.' if x['own_goal'] else ''} ({nation(m['codes'][x['side']])[:3].upper()})")
            for x in v["goals"])
        ref_txt = ("{{1}}" if second_kind == "referee" else g.pname(v["referee"])) if v.get("referee") else None
        city_txt = place_txt(v["city"])
        stadium_txt = place_txt(v.get("stadium")) if v.get("stadium") else None
        d = dt.date.fromisoformat(m["date"])
        body = [
            f"{city_txt}, {date_it(m['date'])}. {ta} e {tb} si sono affrontate"
            f"{' allo stadio ' + stadium_txt if stadium_txt else ''} ({round_it(m['round']).lower()}, Mondiale {m['year']}).",
            f"Il tabellino delle reti: {goals_txt}." + (f" Dopo i supplementari restava il {sa}-{sb}." if v.get("aet") else ""),
        ]
        if v.get("pens"):
            body.append(f"Ai calci di rigore finisce {v['pens'][0]}-{v['pens'][1]}.")
        box = [f"{ta}-{tb} {sa}-{sb}{' d.t.s.' if v.get('aet') else ''}", f"Reti: {goals_txt}"]
        if ref_txt:
            box.append(f"Arbitro: {ref_txt}")
        if stadium_txt:
            box.append(f"Stadio: {stadium_txt}, {city_txt}")
        if v.get("attendance"):
            box.append(f"Spettatori: {v['attendance']:,}".replace(",", "."))
        for side in (0, 1):
            lu = (v.get("lineups") or [None, None])[side]
            if lu:
                box.append(f"{nation(m['codes'][side])}: " + ", ".join(fam(p["title"]) for p in lu))
        page = {"masthead": "La Trivela Sportiva", "date": date_it(m["date"]), "weekday": WEEKDAYS[d.weekday()],
                "kicker": f"Mondiale {m['year']} · {round_it(m['round'])}", "headline": head,
                "subhead": "Reti di " + ", ".join(dict.fromkeys(fam(x["title"]) for x in v["goals"])),
                "body": body, "boxTitle": "Il tabellino", "boxLines": box}
        script = (f"{match_label(m)} ({round_it(m['round']).lower()}, Mondiale {m['year']}): "
                  f"{s0['answer']['display']} tra i marcatori; {s1['label'].lower()}: {s1['answer']['display']}.")
        fame = g.fame(hidden_goal["title"])
        it = base("prima_pagina", m["id"], year=m["year"], fame=fame,
                  entities=ed_entities(m["year"]) + [f"nat:{a}", f"nat:{b}"] + [pid(g, x["title"]) for x in v["goals"]]
                  + ([g.qid(v["city"])] if g.qid(v["city"]) else []),
                  sources=m["sources"], script=script)
        it.update({"page": page, "slots": [s0, s1]})
        out.append(it)
    return out


def scorer_table(g: G, nation_ok: dict[str, bool]) -> dict[str, Counter]:
    by_nation: dict[str, Counter] = defaultdict(Counter)
    for m in g.matches:
        for x in m["verified"].get("scorers", []):
            if x["own_goal"]:
                continue
            code = m["codes"][x["side"]]
            if nation_ok.get(code):
                by_nation[code][x["title"]] += 1
    return by_nation


def wc_sources(years: list[int]) -> list[dict]:
    out = []
    for y in sorted(set(years)):
        out.append({"family": "openfootball", "label": f"openfootball: World Cup {y}",
                    "url": f"https://github.com/openfootball/worldcup.json/blob/master/{y}/worldcup-full.json"})
    out.append({"family": "wikimedia", "label": "Wikipedia: FIFA World Cup (pagine delle partite)",
                "url": "https://en.wikipedia.org/wiki/FIFA_World_Cup"})
    return out


def nation_windows(g: G, goals_ok: set) -> dict[str, tuple[int, int]]:
    """Longest run of consecutive World Cups where the nation's scorers are fully verified
    (editions it did not play count as complete)."""
    played = defaultdict(set)
    for y in WC_YEARS:
        for om in load_matches(y):
            for name in (om.team1, om.team2):
                c = g.g["codes"].get(norm(name))
                if c:
                    played[c].add(y)
    out = {}
    for c, ys in played.items():
        best, cur = None, []
        for y in WC_YEARS:
            if y not in ys or (y, c) in goals_ok:
                cur.append(y)
                if y in ys and (best is None or len([z for z in cur if z in ys]) > len([z for z in range(best[0], best[1] + 1) if z in ys])):
                    first = next(z for z in cur if z in ys)
                    best = (first, y)
            else:
                cur = []
        if best:
            out[c] = best
    return out


def window_scorers(g: G, code: str, window: tuple[int, int]) -> Counter:
    cnt: Counter = Counter()
    for m in g.matches:
        if not (window[0] <= m["year"] <= window[1]) or code not in m["codes"]:
            continue
        for x in m["verified"].get("scorers", []):
            if not x["own_goal"] and m["codes"][x["side"]] == code:
                cnt[x["title"]] += 1
    return cnt


def ranking_of(g: G, cnt: Counter) -> list[dict] | None:
    ranked = sorted(cnt.items(), key=lambda kv: (-kv[1], g.pname(kv[0])))
    if len(ranked) < 12:
        return None
    tenth_val = ranked[9][1]
    out = []
    for title, val in ranked:
        rank = sum(1 for _t, v2 in ranked if v2 > val) + 1
        if rank > 10:
            break
        out.append({"rank": 10 if val == tenth_val else rank, "id": pid(g, title), "name": g.pname(title), "value": val})
    if len([r for r in out if r["rank"] == 10]) > 8 or out[0]["value"] < 3:
        return None
    return out


def scope_note(code: str, y1: int, y2: int) -> str:
    """Clarify ambiguous national-team identities so that correct answers cannot be disputed."""
    if code == "GER" and y1 < 1990 and y2 > 1950:
        return " (esclusa la Germania Ovest 1950-1990)"
    if code == "RUS" and y1 <= 1990:
        return " (esclusa l'Unione Sovietica)"
    if code == "SRB" and y1 <= 2006:
        return " (escluse Jugoslavia e Serbia e Montenegro)"
    if code == "CZE" and y1 <= 1990:
        return " (esclusa la Cecoslovacchia)"
    return ""


def gen_dischetto(g: G, goals_ok: set, snapshot: str) -> list[dict]:
    out = []
    for code, (y1, y2) in nation_windows(g, goals_ok).items():
        cnt = window_scorers(g, code, (y1, y2))
        ranking = ranking_of(g, cnt)
        if not ranking:
            continue
        full = y1 == WC_YEARS[0] or y2 == WC_YEARS[-1]
        span = f"dal {y1} al {y2}"
        top3 = ", ".join(f"{r['name']} ({r['value']})" for r in ranking[:3])
        it = base("dischetto", (code, y1, y2), year=y1, year_max=y2, fame=max(g.fame(t) for t in cnt),
                  entities=["wc", f"nat:{code}"] + [r["id"] for r in ranking],
                  sources=wc_sources([y for y in WC_YEARS if y1 <= y <= y2]),
                  script=f"Nei Mondiali {span} la classifica dei marcatori {prep('di', code)} è guidata da {top3}.")
        it.update({"title": f"I 10 marcatori {prep('di', code)} ai Mondiali {span}{scope_note(code, y1, y2)}",
                   "definition": f"Gol nelle fasi finali dei Mondiali {span}, esclusi autogol e serie di rigori"
                                 + ("" if not full else ""),
                   "unit": "gol", "ranking": ranking, "snapshot": snapshot})
        out.append(it)
    return out


def gen_sets(g: G, squad_ok: set, goals_ok_global: set) -> tuple[list[dict], list[dict]]:
    decina, asta = [], []
    # (club, nation) across complete editions
    groups = defaultdict(set)
    years = defaultdict(set)
    for s in g.squads:
        if (s["year"], s["code"]) in squad_ok and s.get("club"):
            key = (s["club"], s["code"])
            groups[key].add(s["title"])
            years[key].add(s["year"])
    complete_years = defaultdict(list)
    for y, c in squad_ok:
        complete_years[c].append(y)
    for (club, code), members in groups.items():
        n = len(members)
        cy = sorted(complete_years[code])
        if not (8 <= n <= 30):
            continue
        rng_years = f"{cy[0]}–{cy[-1]}"
        title = f"Giocatori {prep('di', code)} convocati per un Mondiale mentre il loro club era {g.club(club)}"
        desc = f"Edizioni considerate: {', '.join(map(str, cy))} (rose verificate su due fonti)."
        mem = sorted(({"id": pid(g, t), "name": g.pname(t)} for t in members), key=lambda x: x["name"])
        script = f"{n} giocatori: {', '.join(x['name'] for x in mem)}."
        it = base("set_club_nation", (club, code), year=cy[0], year_max=cy[-1], fame=g.fame(club),
                  entities=["wc", f"nat:{code}", g.qid(club) or club] + [x["id"] for x in mem],
                  sources=wc_squad_sources(cy), script=script)
        it.update({"title": title, "description": desc + f" Periodo {rng_years}.", "members": mem})
        asta.append(it)
        if 14 <= n <= 17:
            decina.append(dict(it, id=iid("decina", club, code)))
    # scorers of a nation with at least k goals (inside a fully verified window)
    windows = nation_windows(g, goals_ok_global)
    for code, (wy1, wy2) in windows.items():
        cnt = window_scorers(g, code, (wy1, wy2))
        for k in (1, 2, 3, 4):
            members = [t for t, v in cnt.items() if v >= k]
            n = len(members)
            if not (8 <= n <= 30):
                continue
            mem = sorted(({"id": pid(g, t), "name": g.pname(t)} for t in members), key=lambda x: x["name"])
            title = (f"Giocatori {prep('di', code)} che hanno segnato ai Mondiali dal {wy1} al {wy2}" if k == 1 else
                     f"Giocatori {prep('di', code)} con almeno {k} gol ai Mondiali dal {wy1} al {wy2}") + scope_note(code, wy1, wy2)
            it = base("set_scorers", (code, k, wy1, wy2), year=wy1, year_max=wy2, fame=max(g.fame(t) for t in members),
                      entities=["wc", f"nat:{code}"] + [x["id"] for x in mem], sources=wc_sources([y for y in WC_YEARS if wy1 <= y <= wy2]),
                      script=f"{n} giocatori: {', '.join(x['name'] for x in mem)}.")
            it.update({"title": title, "description": "Fasi finali dei Mondiali, esclusi autogol e serie di rigori.",
                       "members": mem})
            asta.append(dict(it, id=iid("asta-scorers", code, k)))
            if 14 <= n <= 17:
                decina.append(dict(it, id=iid("decina-scorers", code, k)))
    return decina, asta


def wc_squad_sources(years: list[int]) -> list[dict]:
    out = []
    for y in years:
        out.append({"family": "wikimedia", "label": f"Wikipedia: {y} FIFA World Cup squads",
                    "url": f"https://en.wikipedia.org/wiki/{y}_FIFA_World_Cup_squads"})
        out.append({"family": "openfootball", "label": f"openfootball: squads {y}",
                    "url": "https://github.com/openfootball/worldcup"})
    return out


def opts4(correct: str, distractors: list[str], key: str) -> tuple[list[str], int] | None:
    ds = [d for d in dict.fromkeys(distractors) if d != correct]
    if len(ds) < 3:
        return None
    r = random.Random(key)
    ds = r.sample(ds, 3)
    opts = ds + [correct]
    r.shuffle(opts)
    return opts, opts.index(correct)


def gen_tiro_secco(g: G, goals_ok: set, squad_ok: set) -> list[dict]:
    out = []
    # A) club at the time of a World Cup
    by_team = defaultdict(list)
    for s in g.squads:
        if s.get("club"):
            by_team[(s["year"], s["code"])].append(s)
    for (y, c), facts in by_team.items():
        clubs = sorted({g.club(f["club"]) for f in facts})
        for f in facts:
            fame = g.fame(f["title"])
            if fame < 30:
                continue
            o = opts4(g.club(f["club"]), clubs, f"club-{y}-{c}-{f['title']}")
            if not o:
                continue
            script = f"Al Mondiale {y} {g.pname(f['title'])} ({nation(c)}) aveva come club {g.club(f['club'])}."
            it = base("ts_club_at_wc", (y, c, f["title"]), year=y, fame=fame,
                      entities=ed_entities(y) + [f"nat:{c}", pid(g, f["title"]), g.qid(f["club"]) or f["club"]],
                      sources=f["sources"], script=script)
            it.update({"question": f"In quale squadra giocava {g.pname(f['title'])} quando disputò il Mondiale {y} {prep('con', c)}?",
                       "options": o[0], "correct": o[1], "archetype": 3})
            out.append(it)
    # B) shirt number
    for s in g.squads:
        if s.get("number") is None or g.fame(s["title"]) < 40:
            continue
        r = random.Random(s["title"] + str(s["year"]))
        pool = [str(n) for n in range(1, 24) if n != s["number"]]
        o = opts4(str(s["number"]), r.sample(pool, 6), f"num-{s['year']}-{s['title']}")
        if not o:
            continue
        it = base("ts_number", (s["year"], s["code"], s["title"]), year=s["year"], fame=g.fame(s["title"]),
                  entities=ed_entities(s["year"]) + [f"nat:{s['code']}", pid(g, s["title"])], sources=s["sources"],
                  script=f"Al Mondiale {s['year']} {g.pname(s['title'])} vestì il numero {s['number']} {prep('di', s['code'])}.")
        it.update({"question": f"Con quale numero di maglia giocò {g.pname(s['title'])} il Mondiale {s['year']}?",
                   "options": o[0], "correct": o[1], "archetype": 1})
        out.append(it)
    # C) captain of a famous match
    for m in g.matches:
        v = m["verified"]
        for side in (0, 1):
            lu = (v.get("lineups") or [None, None])[side]
            if not lu or not is_famous_match(g, m):
                continue
            caps = [p for p in lu if p.get("captain")]
            if len(caps) != 1:
                continue
            cap = caps[0]["title"]
            o = opts4(g.pname(cap), [g.pname(p["title"]) for p in lu if p["title"] != cap], f"cap-{m['id']}-{side}")
            if not o:
                continue
            code = m["codes"][side]
            it = base("ts_captain", (m["id"], side), year=m["year"], fame=g.fame(cap),
                      entities=ed_entities(m["year"]) + [f"nat:{code}", pid(g, cap)], sources=m["sources"],
                      script=f"In {match_label(m)} (Mondiale {m['year']}, {date_it(m['date'])}) la fascia {prep('di', code)} era al braccio di {g.pname(cap)}.")
            it.update({"question": f"Chi era il capitano {prep('di', code)} in {match_label(m)} (Mondiale {m['year']}, {round_it(m['round']).lower()})?",
                       "options": o[0], "correct": o[1], "archetype": 2})
            out.append(it)
    # D) referee of a knockout match
    refs_by_year = defaultdict(set)
    for m in g.matches:
        if m["verified"].get("referee"):
            refs_by_year[m["year"]].add(g.pname(m["verified"]["referee"]))
    for m in g.matches:
        ref = m["verified"].get("referee")
        if not ref or round_it(m["round"]) == "Fase a gironi":
            continue
        o = opts4(g.pname(ref), sorted(refs_by_year[m["year"]]), f"ref-{m['id']}")
        if not o:
            continue
        it = base("ts_referee", m["id"], year=m["year"], fame=g.fame(ref),
                  entities=ed_entities(m["year"]) + [f"nat:{c}" for c in m["codes"]] + [pid(g, ref)], sources=m["sources"],
                  script=f"{match_label(m)} ({round_it(m['round']).lower()}, Mondiale {m['year']}) fu diretta da {g.pname(ref)}.")
        it.update({"question": f"Chi arbitrò {match_label(m)}, {round_it(m['round']).lower()} del Mondiale {m['year']}?",
                   "options": o[0], "correct": o[1], "archetype": 2})
        out.append(it)
    # E) unique weekday among a nation's matches in one edition (schedule must be complete)
    by_ed = defaultdict(list)
    for m in g.matches:
        for side, c in enumerate(m["codes"]):
            by_ed[(m["year"], c)].append(m)
    for (y, c), ms in by_ed.items():
        if (y, c) not in goals_ok or len(ms) < 4:
            continue
        wd = Counter(dt.date.fromisoformat(m["date"]).weekday() for m in ms)
        for day, n in wd.items():
            if n != 1:
                continue
            target = next(m for m in ms if dt.date.fromisoformat(m["date"]).weekday() == day)
            labels = [match_label(m) for m in ms]
            o = opts4(match_label(target), labels, f"wd-{y}-{c}-{day}")
            if not o:
                continue
            it = base("ts_weekday", (y, c, day), year=y, fame=20, entities=ed_entities(y) + [f"nat:{c}"],
                      sources=target["sources"],
                      script=f"Al Mondiale {y} la {nation(c)} giocò di {WEEKDAYS[day]} soltanto {match_label(target)}, il {date_it(target['date'])}.")
            it.update({"question": f"Quale fu l'unica partita {prep('di', c)} al Mondiale {y} giocata di {WEEKDAYS[day]}?",
                       "options": o[0], "correct": o[1], "archetype": 1})
            out.append(it)
    # F) birthday goals (DOB must carry an external reference: second family)
    goals_by_person = defaultdict(list)
    complete_people = set()
    for m in g.matches:
        for x in m["verified"].get("scorers", []):
            if not x["own_goal"]:
                goals_by_person[x["title"]].append((m, {**x, "minute": 0, "extra": 0}))
    for t, gl in goals_by_person.items():
        if all((m["year"], m["codes"][x["side"]]) in goals_ok for m, x in gl):
            complete_people.add(t)

    def dob(t: str) -> str | None:
        return g.people.get(g.qid(t) or "", {}).get("dob")

    def bday_goals(t: str):
        d = dob(t)
        return [(m, x) for m, x in goals_by_person[t] if d and m["date"][5:] == d[5:]] if d else []

    no_bday = [t for t in complete_people if dob(t) and not bday_goals(t) and g.fame(t) >= 30]
    for t in complete_people:
        bg = bday_goals(t)
        if not bg:
            continue
        m, x = bg[0]
        era = [d for d in no_bday if abs(goals_by_person[d][0][0]["year"] - m["year"]) <= 12]
        o = opts4(g.pname(t), [g.pname(d) for d in era], f"bday-{t}")
        if not o:
            continue
        age = m["year"] - int(dob(t)[:4])
        p = g.people[g.qid(t)]
        refs = [{"family": fam, "label": f"Wikidata (riferimento: {fam})", "url": url if str(url).startswith("http") else f"https://www.wikidata.org/wiki/{p['qid']}"}
                for fam, url in (p.get("dob_refs") or {}).items()]
        refs.append({"family": "wikimedia", "label": "Wikidata", "url": f"https://www.wikidata.org/wiki/{p['qid']}"})
        it = base("ts_birthday_goal", t, year=m["year"], fame=g.fame(t),
                  entities=ed_entities(m["year"]) + [pid(g, t)] + [f"nat:{c}" for c in m["codes"]],
                  sources=m["sources"] + refs,
                  script=f"{g.pname(t)} segnò in {match_label(m)} il {date_it(m['date'])}, il giorno del suo {age}° compleanno.")
        it.update({"question": "Quale di questi giocatori ha segnato in un Mondiale proprio nel giorno del suo compleanno?",
                   "options": o[0], "correct": o[1], "archetype": 1})
        out.append(it)
    # G) first World Cup goal: opponent
    for t in complete_people:
        gl = sorted(goals_by_person[t], key=lambda mx: mx[0]["date"])
        if g.fame(t) < 40 or not gl:
            continue
        m, x = gl[0]
        own = m["codes"][x["side"]]
        opp = m["codes"][1 - x["side"]]
        if sum(1 for mm, _ in gl if mm["id"] == m["id"]) < 1:
            continue
        others = sorted({nation(c) for mm in g.matches if own in mm["codes"] and mm["year"] in {y for y in range(m["year"] - 8, m["year"] + 9)}
                         for c in mm["codes"] if c not in (own, opp)})
        o = opts4(nation(opp), others, f"first-{t}")
        if not o:
            continue
        it = base("ts_first_goal", t, year=m["year"], fame=g.fame(t),
                  entities=ed_entities(m["year"]) + [pid(g, t), f"nat:{own}", f"nat:{opp}"], sources=m["sources"],
                  script=f"Il primo gol di {g.pname(t)} ai Mondiali arrivò in {match_label(m)} il {date_it(m['date'])}.")
        it.update({"question": f"Contro quale nazionale {g.pname(t)} segnò il suo primo gol ai Mondiali?",
                   "options": o[0], "correct": o[1], "archetype": 3})
        out.append(it)
    return out


def gen_cassaforte(g: G) -> list[dict]:
    out = []
    for m in g.matches:
        v = m["verified"]
        if not v.get("goals_complete") or not v.get("score"):
            continue
        goals = [x for x in v["goals"] if not x["own_goal"]]
        a, b = m["codes"]
        ent = ed_entities(m["year"]) + [f"nat:{a}", f"nat:{b}"]
        for x in goals:
            minute = f"{x['minute']}+{x['extra']}" if x["extra"] else str(x["minute"])
            team = nation(m["codes"][x["side"]])
            fame = g.fame(x["title"])
            level = 1 if fame >= 70 else 2 if fame >= 30 else 3
            if level == 3 and len(goals) == 2:
                continue
            it = base("cf_scorer", (m["id"], x["title"], minute), year=m["year"], fame=fame,
                      entities=ent + [pid(g, x["title"])], sources=m["sources"],
                      script=f"Al {minute}' di {match_label(m)} ({round_it(m['round']).lower()}, Mondiale {m['year']}) segnò {g.pname(x['title'])} {prep('per', m['codes'][x['side']])}.")
            it.update({"level": level, "question": f"Chi segnò {prep('per', m['codes'][x['side']])} al {minute}' di {match_label(m)} ({round_it(m['round']).lower()}, Mondiale {m['year']})?",
                       "parts": [person_answer(g, x["title"])]})
            out.append(it)
        if len(goals) == 2 and len(v["goals"]) == 2 and goals[0]["title"] != goals[1]["title"]:
            fame = min(g.fame(x["title"]) for x in goals)
            it = base("cf_two_scorers", m["id"], year=m["year"], fame=fame,
                      entities=ent + [pid(g, x["title"]) for x in goals], sources=m["sources"],
                      script=f"In {match_label(m)} segnarono {g.pname(goals[0]['title'])} e {g.pname(goals[1]['title'])}.")
            it.update({"level": 3, "question": f"Chi furono i due marcatori di {match_label(m)} ({round_it(m['round']).lower()}, Mondiale {m['year']})? Servono entrambi.",
                       "parts": [person_answer(g, goals[0]["title"]), person_answer(g, goals[1]["title"])]})
            out.append(it)
        if v.get("referee") and round_it(m["round"]) in ("Finale", "Semifinale"):
            it = base("cf_referee", m["id"], year=m["year"], fame=g.fame(v["referee"]),
                      entities=ent + [pid(g, v["referee"])], sources=m["sources"],
                      script=f"{match_label(m)} fu arbitrata da {g.pname(v['referee'])}.")
            it.update({"level": 2 if round_it(m["round"]) == "Finale" else 3,
                       "question": f"Chi arbitrò {match_label(m)}, {round_it(m['round']).lower()} del Mondiale {m['year']}?",
                       "parts": [person_answer(g, v["referee"])]})
            out.append(it)
    return out


def gen_intruso(g: G, squad_ok: set) -> list[dict]:
    out = []
    members = defaultdict(set)
    for s in g.squads:
        members[(s["year"], s["code"])].add(s["title"])
    by_code = defaultdict(list)
    for y, c in squad_ok:
        by_code[c].append(y)
    for c, years in by_code.items():
        years.sort()
        props = {}
        for y1, y2 in combinations(years, 2):
            if y2 - y1 > 12:
                continue
            props[(y1, y2)] = members[(y1, c)] & members[(y2, c)]
        for (y1, y2), both in props.items():
            if len(both) < 3:
                continue
            only1 = members[(y1, c)] - members[(y2, c)]
            famous = sorted(both, key=lambda t: -g.fame(t))[:8]
            r = random.Random(f"intr-{c}-{y1}-{y2}")
            if len(famous) < 3 or not only1:
                continue
            trio = r.sample(famous, 3)
            intr = max(only1, key=lambda t: g.fame(t))
            four = trio + [intr]
            # ambiguity: no other property splits 3-1 with a different odd one
            ambiguous = False
            for (z1, z2), s2 in props.items():
                if (z1, z2) == (y1, y2):
                    continue
                inside = [t in s2 for t in four]
                if sum(inside) == 3 and inside.index(False) != 3:
                    ambiguous = True
                    break
            if ambiguous:
                continue
            distract = [f"Convocati {prep('con', c)} sia al Mondiale {z1} sia al {z2}"
                        for (z1, z2), s2 in props.items() if (z1, z2) != (y1, y2) and not all(t in s2 for t in trio)]
            correct = f"Convocati {prep('con', c)} sia al Mondiale {y1} sia al {y2}"
            o = opts4(correct, distract, f"intr-links-{c}-{y1}-{y2}")
            if not o:
                continue
            order = trio + [intr]
            r.shuffle(order)
            names = [g.pname(t) for t in order]
            it = base("intruso_squads", (c, y1, y2), year=y1, year_max=y2, fame=min(g.fame(t) for t in four),
                      entities=ed_entities(y1) + [f"wc:{y2}", f"nat:{c}"] + [pid(g, t) for t in four],
                      sources=wc_squad_sources([y1, y2]),
                      script=f"{', '.join(g.pname(t) for t in trio)} furono convocati sia nel {y1} sia nel {y2}; {g.pname(intr)} era nella rosa del {y1} ma non in quella del {y2}.",
                      active=[max(y for (y, cc), mem in members.items() if cc == c and t in mem) for t in four])
            it.update({"names": names, "intruder": order.index(intr), "links": o[0], "correctLink": o[1]})
            out.append(it)
    return out


def teammate_graph(g: G) -> dict:
    groups, by_person = {}, defaultdict(list)
    for s in g.squads:
        key = f"sq:{s['year']}:{s['code']}"
        if key not in groups:
            groups[key] = {"label": f"{nation(s['code'])} · Mondiale {s['year']}", "members": []}
        p = pid(g, s["title"])
        groups[key]["members"].append(p)
        by_person[p].append(key)
    return {"groups": groups, "byPerson": dict(by_person)}


def gen_filo_rosso(g: G, tm: dict) -> list[dict]:
    from collections import deque
    title_of = {pid(g, s["title"]): s["title"] for s in g.squads}
    last_year = defaultdict(int)
    for s in g.squads:
        p = pid(g, s["title"])
        last_year[p] = max(last_year[p], s["year"])
    famous = sorted({p for p in tm["byPerson"] if g.fame(title_of[p]) >= 70}, key=lambda p: -g.fame(title_of[p]))

    def bfs(src: str):
        prev = {src: None}
        q = deque([src])
        while q:
            u = q.popleft()
            for grp in tm["byPerson"].get(u, []):
                for v in tm["groups"][grp]["members"]:
                    if v not in prev:
                        prev[v] = u
                        q.append(v)
        return prev

    out = []
    r = random.Random(7)
    for src in famous[:120]:
        prev = bfs(src)
        targets = []
        for dst in famous:
            if dst == src or dst not in prev:
                continue
            path = [dst]
            while prev[path[-1]] is not None:
                path.append(prev[path[-1]])
            links = len(path) - 1
            if 2 <= links <= 4:
                targets.append((dst, path[::-1]))
        if not targets:
            continue
        dst, path = r.choice(targets)
        a, b = title_of[src], title_of[dst]
        years = sorted({int(gid.split(":")[1]) for p in path for gid in tm["byPerson"][p]})
        it = base("filo_rosso", (src, dst), year=years[0], year_max=years[-1], fame=min(g.fame(a), g.fame(b)),
                  entities=["wc"] + path, sources=wc_squad_sources(sorted({y for y in years})),
                  script=f"Una catena minima: {' → '.join(g.pname(title_of[p]) for p in path)} (compagni nella stessa rosa mondiale).",
                  active=[last_year[src], last_year[dst]])
        it.update({"from": {"id": src, "name": g.pname(a)}, "to": {"id": dst, "name": g.pname(b)}, "optimal": len(path) - 1,
                   "solution": [{"id": p, "name": g.pname(title_of[p])} for p in path]})
        out.append(it)
    return out


def gen_giramondo(g: G) -> list[dict]:
    by_person = defaultdict(list)
    for s in g.squads:
        if s.get("club"):
            by_person[s["title"]].append(s)
    out = []
    for t, facts in by_person.items():
        facts.sort(key=lambda s: s["year"])
        clubs = list(dict.fromkeys(g.club(f["club"]) for f in facts))
        if len(facts) < 3 or len(clubs) < 2 or g.fame(t) < 40:
            continue
        clues = [f"Mondiale {f['year']} · club: {g.club(f['club'])}" for f in facts]
        clues.sort(key=lambda c: g.fame(next(f["club"] for f in facts if g.club(f["club"]) in c)))
        code = facts[-1]["code"]
        pos = next((POSITIONS[f["pos"]] for f in facts if f.get("pos")), None)
        nums = sorted({f["number"] for f in facts if f.get("number")})
        extra = []
        if pos:
            extra.append(f"Ruolo in rosa: {pos}")
        if nums:
            extra.append("Numeri di maglia ai Mondiali: " + ", ".join(map(str, nums)))
        extra.append(f"Nazionale: {nation(code)}")
        allc = clues + extra
        if len(allc) < 5:
            continue
        five = [*allc[: len(allc) - 3][:2], *allc[-3:]] if len(allc) > 5 else allc
        if len(five) != 5:
            continue
        sources = [src for f in facts for src in f["sources"]]
        it = base("giramondo_wc", t, year=facts[0]["year"], year_max=facts[-1]["year"], fame=g.fame(t),
                  entities=["wc", f"nat:{code}", pid(g, t)] + [g.qid(f["club"]) or f["club"] for f in facts],
                  sources=sources, script=f"{g.pname(t)}: " + "; ".join(clues) + ".", active=[facts[-1]["year"]])
        it.update({"clues": five, "answer": person_answer(g, t)})
        out.append(it)
    return out


# --------------------------------------------------------------------------- entities & topics

def build_entities(g: G, used: set[str]) -> tuple[list[dict], dict]:
    ents = {}
    ents["wc"] = {"id": "wc", "kind": "competition", "name": "Mondiali", "fame": 300,
                  "aliases": ["Mondiale", "Coppa del Mondo", "World Cup", "Mondiali di calcio", "FIFA World Cup"]}
    for y in WC_YEARS:
        hosts = HOSTS.get(y, [])
        ents[f"wc:{y}"] = {"id": f"wc:{y}", "kind": "edition", "name": f"Mondiale {y}", "fame": 150, "years": [y],
                           "aliases": [f"Mondiali {y}", f"World Cup {y}"] + [f"{h} {y}" for h in hosts]
                           + [f"{h} {str(y)[2:]}" for h in hosts] + [f"{h} '{str(y)[2:]}" for h in hosts]}
    codes = {c for m in g.matches for c in m["codes"]}
    names_en = defaultdict(set)
    for k, v in g.g["codes"].items():
        names_en[v].add(k)
    for c in codes:
        ents[f"nat:{c}"] = {"id": f"nat:{c}", "kind": "nation", "name": nation(c), "fame": 120,
                            "aliases": sorted({n.title() for n in names_en.get(c, set())} | {f"Nazionale {nation(c)}"})}
    years = defaultdict(set)
    for s in g.squads:
        years[pid(g, s["title"])].add(s["year"])
    titles = {pid(g, s["title"]): s["title"] for s in g.squads}
    for m in g.matches:
        v = m["verified"]
        for x in v.get("goals", []):
            titles.setdefault(pid(g, x["title"]), x["title"])
            years[pid(g, x["title"])].add(m["year"])
        for lu in v.get("lineups") or []:
            for p in lu or []:
                titles.setdefault(pid(g, p["title"]), p["title"])
                years[pid(g, p["title"])].add(m["year"])
        if v.get("referee"):
            titles.setdefault(pid(g, v["referee"]), v["referee"])
    for p, t in titles.items():
        q = g.qid(t)
        info = g.people.get(q or "", {})
        name = g.pname(t)
        aliases = set(info.get("aliases", [])) | {strip_disambiguation(t)}
        if info.get("en"):
            aliases.add(info["en"])
        aliases.discard(name)
        ents[p] = {"id": p, "kind": "person", "name": name, "fame": g.fame(t), "family": g.family(t),
                   "aliases": sorted(a for a in aliases if a and len(a) < 60)[:8], "years": sorted(years.get(p, []))}
    club_stop = {"fc", "f c", "cf", "ac", "as", "ssc", "sc", "cd", "afc", "club", "calcio", "sv", "fk", "sk", "f.c.", "a.c."}
    for title in {s["club"] for s in g.squads if s.get("club")}:
        q = g.qid(title) or title
        info = g.places.get(q, {})
        name = g.club(title)
        base_names = {strip_disambiguation(title), info.get("en") or title, name, g.place(title)}
        short = set()
        for b in base_names:
            toks = [t for t in b.replace(".", " ").split() if t.lower() not in club_stop and not t.isdigit()]
            if toks:
                short.add(" ".join(toks))
        name = g.club(title)
        ents[q] = {"id": q, "kind": "club", "name": name,
                   "fame": g.fame(title), "aliases": sorted((base_names | short) - {name})}
    for m in g.matches:
        city = m["verified"].get("city")
        if city and g.qid(city):
            q = g.qid(city)
            info = g.places.get(q, {})
            ents[q] = {"id": q, "kind": "city", "name": g.place(city), "fame": g.fame(city),
                       "aliases": sorted({strip_disambiguation(city), info.get("en") or city} - {g.place(city)})}
    # topics graph
    nb = defaultdict(set)

    def link(a: str, b: str):
        nb[a].add(b)
        nb[b].add(a)

    for y in WC_YEARS:
        link("wc", f"wc:{y}")
    for m in g.matches:
        for c in m["codes"]:
            link(f"wc:{m['year']}", f"nat:{c}")
        city = m["verified"].get("city")
        if city and g.qid(city):
            link(f"wc:{m['year']}", g.qid(city))
    for s in g.squads:
        p = pid(g, s["title"])
        link(f"nat:{s['code']}", p)
        if s.get("club"):
            link(p, g.qid(s["club"]) or s["club"])
    # person nicknames that collide with a team/place name (e.g. alias "Italia") are dropped
    reserved = {norm(n) for e in ents.values() if e["kind"] != "person" for n in [e["name"], *e["aliases"]]}
    for e in ents.values():
        if e["kind"] == "person":
            e["aliases"] = [a for a in e["aliases"] if norm(a) not in reserved]
    ent_list = sorted(ents.values(), key=lambda e: e["id"])
    return ent_list, {"neighbors": {k: sorted(v) for k, v in nb.items()}}


# --------------------------------------------------------------------------- main

def main() -> None:
    graph = json.loads((BUILD / "graph.json").read_text(encoding="utf-8"))
    g = G(graph)
    snapshot = dt.date.today().isoformat()
    goals_ok, squad_ok, nation_ok = completeness(g)
    tm = teammate_graph(g)
    decina, asta = gen_sets(g, squad_ok, goals_ok)
    packs = {
        "tiro_secco": gen_tiro_secco(g, goals_ok, squad_ok),
        "prima_pagina": gen_prima_pagina(g),
        "mercato": [],
        "decina": decina,
        "dischetto": gen_dischetto(g, goals_ok, snapshot),
        "formazione": gen_formazione(g),
        "cassaforte": gen_cassaforte(g),
        "giramondo": gen_giramondo(g),
        "frame": gen_frame(g),
        "intruso": gen_intruso(g, squad_ok),
        "asta": asta,
        "filo_rosso": gen_filo_rosso(g, tm),
        "mappamondo": gen_mappamondo(g),
        "maglia": gen_maglia(g),
    }
    for q in load_published():
        common = {"id": q["id"], "generator": "redazione", "yearMin": q["year_min"], "yearMax": q["year_max"],
                  "difficulty": q["difficulty"], "fame": q.get("fame", 30), "entities": q.get("entities", []),
                  "sources": [{"family": src["family"], "label": src.get("label", src["family"]), "url": src["url"]}
                              for c in q["claims"] for src in c["sources"]],
                  "script": q["script"]}
        if "tiro_secco" in q["game"] and "options" in q:
            packs["tiro_secco"].append({**common, "question": q["question"], "options": q["options"],
                                        "correct": q["correct"], "archetype": q["archetype"]})
        if "cassaforte" in q["game"]:
            packs["cassaforte"].append({**common, "id": q["id"] + "-cf", "level": q["difficulty"], "question": q["question"],
                                        "parts": [{"kind": "text", "accepted": q.get("accepted", []), "display": q["answer"]}]})
    # ---- Transfermarkt history, national teams, 2026/27 delta (SPEC §0.3: single authoritative source)
    from .gen_tm import generate_all as tm_generate
    from .intl import delta_all, intl_entities
    tm_packs, tm_ents, tm_graph, tm_topic_nb = tm_generate()
    from .gen_hist import generate_hist, hist_entities
    from .postprocess import notable_tm_ids
    from .gen_tm import TM as _TM
    hist_packs = generate_hist(notable_tm_ids(_TM()))
    for src_packs in (tm_packs, delta_all(), hist_packs):
        for game, items in src_packs.items():
            packs.setdefault(game, []).extend(items)
    # every instance must cite at least one source
    for game, items in packs.items():
        bad = [it["id"] for it in items if not it["sources"]]
        if bad:
            raise SystemExit(f"{game}: {len(bad)} instances without a source")
        ids = [it["id"] for it in items]
        if len(ids) != len(set(ids)):
            seen = set()
            packs[game] = [it for it in items if not (it["id"] in seen or seen.add(it["id"]))]
    used = {e for items in packs.values() for it in items for e in it["entities"]}
    entities, topics = build_entities(g, used)
    known = {e["id"] for e in entities}
    for e in tm_ents + intl_entities() + hist_entities(hist_packs):
        if e["id"] in known:
            continue
        known.add(e["id"])
        entities.append(e)
    for k, v in tm_topic_nb.items():
        topics["neighbors"][k] = sorted(set(topics["neighbors"].get(k, [])) | set(v))
    tm["groups"].update(tm_graph["groups"])
    for p, gs in tm_graph["byPerson"].items():
        tm["byPerson"].setdefault(p, []).extend(gs)
    from .postprocess import finalize
    from . import gen_tm as _gen_tm
    qmap = dict(_gen_tm.LAST_QMAP)
    packs, entities, filter_report = finalize(packs, entities, graph["people"], qmap)
    (PACKS_OUT / "games").mkdir(parents=True, exist_ok=True)
    for game, items in packs.items():
        (PACKS_OUT / "games" / f"{game}.json").write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (PACKS_OUT / "entities.json").write_text(json.dumps(entities, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (PACKS_OUT / "teammates.json").write_text(json.dumps(tm, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (PACKS_OUT / "topics.json").write_text(json.dumps(topics, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    manifest = {
        "version": snapshot,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "snapshot": snapshot,
        "counts": {k: len(v) for k, v in packs.items()},
        "sources": [{"family": f, "label": lab, "url": url, "licence": lic} for f, (lab, url, lic) in FAMILY_LABELS.items()],
        "coverage": {"goals_complete_team_editions": len(goals_ok), "squads_complete_team_editions": len(squad_ok)},
    }
    (PACKS_OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest["filters"] = filter_report
    (PACKS_OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest["counts"], indent=2))
    print(json.dumps(filter_report))
    print(json.dumps(manifest["coverage"]))


if __name__ == "__main__":
    main()

__all__ = ["main", "wc_pages", "rng", "http"]

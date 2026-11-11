"""Build the verified graph: link entities across sources and keep only concordant facts.

Families used here:
  - openfootball (public domain dataset)
  - wikimedia (Wikipedia match pages citing FIFA match reports; Wikidata)
  - statsbomb (StatsBomb Open Data, where available)
A fact is kept only if at least two families agree on it.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import asdict

from . import http
from .fetch import wc_pages
from .openfootball import OMatch, load_matches, load_squads, squads_url
from .paths import BUILD, SB_RAW, WC_YEARS
from .text import best_match, name_score, norm, same_club, same_place
from .wiki import WMatch, parse_football_boxes, parse_squads

WP = "https://en.wikipedia.org/wiki/"


def wp_url(title: str) -> str:
    return WP + title.replace(" ", "_")


# --------------------------------------------------------------------------- StatsBomb

def load_statsbomb() -> dict[int, list[dict]]:
    comps = http.get_json(f"{SB_RAW}/data/competitions.json", min_interval=0.2)
    out: dict[int, list[dict]] = defaultdict(list)
    for c in comps:
        if c["competition_id"] != 43 or c["competition_gender"] != "male":
            continue
        for m in http.get_json(f"{SB_RAW}/data/matches/43/{c['season_id']}.json", min_interval=0.2):
            lu = http.get_json(f"{SB_RAW}/data/lineups/{m['match_id']}.json", min_interval=0.2)
            m["_lineups"] = lu
            out[int(m["match_date"][:4])].append(m)
    return out


# --------------------------------------------------------------------------- team codes

def global_name_codes() -> dict[str, str]:
    codes: dict[str, str] = {}
    for y in WC_YEARS:
        for p in load_squads(y):
            codes.setdefault(norm(p.team), p.code)
    return codes


def code_for(name: str, codes: dict[str, str]) -> str | None:
    return codes.get(norm(name))


# --------------------------------------------------------------------------- per-edition build

def dedupe(matches: list[WMatch]) -> list[WMatch]:
    seen: dict[tuple, WMatch] = {}
    for m in matches:
        key = (m.date, m.code1, m.code2)
        if key in seen:
            if not seen[key].lineups and m.lineups:
                seen[key] = m
            continue
        seen[key] = m
    return list(seen.values())


def build_edition(year: int, codes: dict[str, str], sb_matches: list[dict], report: Counter) -> dict:
    om = load_matches(year)
    osq = load_squads(year)
    pages = wc_pages(year)
    texts = http.wp_wikitext(pages)
    wms: list[WMatch] = []
    for p in pages:
        if p in texts:
            wms += parse_football_boxes(p, texts[p])
    wms = dedupe([m for m in wms if m.date and m.code1 and m.code2])
    sq_title = f"{year} FIFA World Cup squads"
    wsq = parse_squads(http.wp_wikitext([sq_title]).get(sq_title, ""))

    # learn codes for unknown OF team names by pairing on date + score
    for m in om:
        for name in (m.team1, m.team2):
            if code_for(name, codes):
                continue
            same_day = [w for w in wms if w.date == m.date and w.score == m.score]
            if len(same_day) == 1:
                w = same_day[0]
                c1 = code_for(m.team1, codes)
                c2 = code_for(m.team2, codes)
                if name == m.team1 and (c2 in (w.code2, None)):
                    codes[norm(name)] = w.code1  # type: ignore[assignment]
                elif name == m.team2 and (c1 in (w.code1, None)):
                    codes[norm(name)] = w.code2  # type: ignore[assignment]

    # WP squads: heading -> code by majority of lineup appearances
    title_codes: dict[str, Counter] = defaultdict(Counter)
    for w in wms:
        for side, lu in enumerate(w.lineups):
            code = w.code1 if side == 0 else w.code2
            for p in lu:
                title_codes[p.title][code] += 1
    heading_code: dict[str, str] = {}
    by_heading: dict[str, list] = defaultdict(list)
    for p in wsq:
        by_heading[p.team].append(p)
    for heading, players in by_heading.items():
        votes = Counter()
        for p in players:
            votes.update(title_codes.get(p.title, Counter()))
        if votes:
            heading_code[heading] = votes.most_common(1)[0][0]
        elif code_for(heading, codes):
            heading_code[heading] = code_for(heading, codes)  # type: ignore[assignment]
    wsq_by_code: dict[str, list] = defaultdict(list)
    for p in wsq:
        c = heading_code.get(p.team)
        if c:
            wsq_by_code[c].append(p)
    osq_by_code: dict[str, list] = defaultdict(list)
    for p in osq:
        osq_by_code[p.code].append(p)

    # candidate titles per code: WP squad + WP lineups
    titles_by_code: dict[str, set[str]] = defaultdict(set)
    for c, ps in wsq_by_code.items():
        titles_by_code[c].update(p.title for p in ps)
    for t, cnt in title_codes.items():
        for c in cnt:
            titles_by_code[c].add(t)

    def resolve(name: str, code: str | None) -> str | None:
        if not code:
            return None
        return best_match(name, sorted(titles_by_code.get(code, set())))

    # ---------------- squads: numbers, clubs, positions
    squad_facts: list[dict] = []
    sb_numbers: dict[tuple[str, str], int] = {}
    for sm in sb_matches:
        for team in sm["_lineups"]:
            code = code_for(team["team_name"], codes)
            if not code:
                continue
            for pl in team["lineup"]:
                t = resolve(pl.get("player_nickname") or pl["player_name"], code) or resolve(pl["player_name"], code)
                if t and pl.get("jersey_number") is not None:
                    sb_numbers[(code, t)] = int(pl["jersey_number"])
    for code, players in wsq_by_code.items():
        ofs = osq_by_code.get(code, [])
        for p in players:
            fact = {"year": year, "code": code, "title": p.title, "sources": [
                {"family": "wikimedia", "label": f"Wikipedia: {sq_title}", "url": wp_url(sq_title)}]}
            ofm = None
            if ofs:
                cands = [o for o in ofs if name_score(o.name, p.title) >= 0.75]
                if p.number is not None:
                    num_c = [o for o in cands if o.number == p.number]
                    ofm = num_c[0] if len(num_c) == 1 else None
                elif len(cands) == 1:
                    ofm = cands[0]
            if ofm:
                fact["sources"].append({"family": "openfootball", "label": f"openfootball: squads {year}",
                                        "url": squads_url(year)})
                fact["member"] = True
                if p.number is not None and ofm.number == p.number:
                    fact["number"] = p.number
                if ofm.pos == p.pos:
                    fact["pos"] = p.pos
                if p.club_title and same_club(ofm.club, p.club_label or p.club_title):
                    fact["club"] = p.club_title
                    fact["club_label"] = p.club_label
            sbn = sb_numbers.get((code, p.title))
            if sbn is not None and p.number == sbn:
                fact["number"] = sbn
                fact["member"] = True
                fact["sources"].append({"family": "statsbomb", "label": "StatsBomb Open Data", "url": f"{SB_RAW}/data/competitions.json"})
            if fact.get("member"):
                squad_facts.append(fact)
                report["squad_verified"] += 1
            else:
                report["squad_unverified"] += 1

    # ---------------- matches
    matches: list[dict] = []
    for m in om:
        c1, c2 = code_for(m.team1, codes), code_for(m.team2, codes)
        if not c1 or not c2:
            report["match_no_code"] += 1
            continue
        cands = [w for w in wms if w.date == m.date and {w.code1, w.code2} == {c1, c2}]
        if len(cands) != 1:
            report["match_unpaired"] += 1
            continue
        w = cands[0]
        swap = w.code1 != c1
        rec = verify_match(m, w, swap, c1, c2, resolve, report)
        sb = pair_sb(m, sb_matches)
        if sb:
            add_sb_lineups(rec, sb, codes, resolve)
        matches.append(rec)
    return {"year": year, "matches": matches, "squads": squad_facts}


def verify_match(m: OMatch, w: WMatch, swap: bool, c1: str, c2: str, resolve, report: Counter) -> dict:
    sources = [
        {"family": "openfootball", "label": f"openfootball: World Cup {m.year}", "url": m.url},
        {"family": "wikimedia", "label": f"Wikipedia: {w.page}", "url": wp_url(w.page)},
    ]
    rec: dict = {"id": f"wc{m.year}-{m.idx:03d}", "year": m.year, "date": m.date, "round": m.round,
                 "codes": [c1, c2], "sources": sources, "verified": {}}
    v = rec["verified"]
    wscore = (w.score[1], w.score[0]) if (swap and w.score) else w.score
    if m.score and wscore and tuple(m.score) == tuple(wscore):
        v["score"] = list(m.score)
        if m.aet:
            v["aet"] = True
        if m.pens:
            v["pens"] = list(m.pens)  # shoot-out shown only alongside a concordant score
        report["score_ok"] += 1
    else:
        report["score_mismatch"] += 1

    # goals: multiset of (title, minute, extra, own_goal, side)
    wgoals = []
    for side, gl in ((0, w.goals1), (1, w.goals2)):
        s = (1 - side) if swap else side
        for g in gl:
            wgoals.append((g.title, g.minute, g.extra, g.own_goal, s, g.penalty))
    ogoals = []
    unresolved = False
    for g in m.goals:
        scorer_code = (c2 if g.side == 0 else c1) if g.own_goal else (c1 if g.side == 0 else c2)
        t = resolve(g.name, scorer_code)
        if not t:
            unresolved = True
            continue
        ogoals.append((t, g.minute, g.extra, g.own_goal, g.side, g.penalty))
    key = lambda x: (x[0], x[1], x[2], x[3], x[4])  # noqa: E731
    wc = Counter(key(x) for x in wgoals)
    oc = Counter(key(x) for x in ogoals)
    agreed = wc & oc
    pen_w = {key(x): x[5] for x in wgoals}
    pen_o = {key(x): x[5] for x in ogoals}
    v["goals"] = [
        {"title": k[0], "minute": k[1], "extra": k[2], "own_goal": k[3], "side": k[4],
         "penalty": bool(pen_w.get(k) and pen_o.get(k))}
        for k, n in agreed.items() for _ in range(n)
    ]
    v["goals"].sort(key=lambda g: (g["minute"], g["extra"]))
    complete = (not unresolved) and wc == oc and "score" in v and sum(agreed.values()) == sum(v["score"])
    v["goals_complete"] = complete
    report["goals_complete" if complete else "goals_partial"] += 1

    # line-ups (starters)
    lineups = [None, None]
    for side in (0, 1):
        ws = w.lineups[(1 - side) if swap else side] if len(w.lineups) == 2 else None
        if not ws or side >= len(m.starters):
            continue
        code = c1 if side == 0 else c2
        o_titles = []
        for name, _cap in m.starters[side]:
            t = resolve(name, code)
            o_titles.append(t)
        w_start = [p for p in ws if p.starter]
        if None not in o_titles and len(w_start) == 11 and set(o_titles) == {p.title for p in w_start}:
            caps_o = {resolve(n, code) for n, cap in m.starters[side] if cap}
            lineups[side] = [
                {"title": p.title, "number": p.number, "pos": p.pos,
                 "captain": p.captain and p.title in caps_o}
                for p in w_start
            ]
            report["lineup_ok"] += 1
        else:
            report["lineup_mismatch"] += 1
    v["lineups"] = lineups

    if m.city and w.city and same_place(m.city, w.city):
        v["city"] = w.city
    if m.stadium and w.stadium and same_place(m.stadium, w.stadium):
        v["stadium"] = w.stadium
    if m.referee and w.referee and name_score(m.referee, w.referee) >= 0.8:
        v["referee"] = w.referee
    if m.attendance and w.attendance and m.attendance == w.attendance:
        v["attendance"] = m.attendance
    return rec


def pair_sb(m: OMatch, sb_matches: list[dict]) -> dict | None:
    c = [s for s in sb_matches if s["match_date"] == m.date and
         name_score(s["home_team"]["home_team_name"], m.team1) + name_score(s["away_team"]["away_team_name"], m.team2) >= 1.5]
    if len(c) == 1:
        return c[0]
    c = [s for s in sb_matches if s["match_date"] == m.date and
         name_score(s["home_team"]["home_team_name"], m.team2) + name_score(s["away_team"]["away_team_name"], m.team1) >= 1.5]
    return c[0] if len(c) == 1 else None


def add_sb_lineups(rec: dict, sb: dict, codes, resolve) -> None:
    rec["sources"].append({"family": "statsbomb", "label": "StatsBomb Open Data",
                           "url": f"{SB_RAW}/data/lineups/{sb['match_id']}.json"})
    rec["verified"]["sb_match"] = sb["match_id"]


# --------------------------------------------------------------------------- Wikidata enrichment

EXTERNAL_REF = [
    ("transfermarkt", "transfermarkt"), ("worldfootball", "worldfootball"), ("national football teams", "nft"),
    ("national-football-teams", "nft"), ("fifa", "fifa"), ("soccerway", "soccerway"), ("eu-football", "eu-football"),
    ("integrated authority file", "authority"), ("bnf", "authority"), ("library of congress", "authority"),
    ("gemeinsame normdatei", "authority"), ("fbref", "fbref"), ("kicker", "kicker"), ("olympedia", "olympedia"),
    ("footballdatabase", "footballdatabase"), ("bdfutbol", "bdfutbol"), ("uefa", "uefa"), ("munzinger", "munzinger"),
    ("enciclopedia", "treccani"), ("treccani", "treccani"), ("lega serie a", "legaseriea"), ("figc", "figc"),
    ("soccerdonna", "soccerdonna"), ("rsssf", "rsssf"), ("sports-reference", "sports-reference"),
]


def ref_family(label: str | None, url: str | None) -> str | None:
    s = f"{label or ''} {url or ''}".lower()
    if "wikipedia" in s or "wikimedia" in s or "wikidata" in s:
        return None
    for needle, fam in EXTERNAL_REF:
        if needle in s:
            return fam
    return None


def wikidata_people(qids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(qids), 150):
        chunk = qids[i:i + 150]
        values = " ".join(f"wd:{q}" for q in chunk)
        rows = http.sparql(f"""
SELECT ?p ?it ?en ?links ?dob ?prec ?refLabel ?refUrl ?fam ?giv WHERE {{
  VALUES ?p {{ {values} }}
  OPTIONAL {{ ?p rdfs:label ?it FILTER(lang(?it)="it") }}
  OPTIONAL {{ ?p rdfs:label ?en FILTER(lang(?en)="en") }}
  OPTIONAL {{ ?p wikibase:sitelinks ?links }}
  OPTIONAL {{ ?p wdt:P734 ?f . ?f rdfs:label ?fam FILTER(lang(?fam)="en") }}
  OPTIONAL {{ ?p wdt:P735 ?g . ?g rdfs:label ?giv FILTER(lang(?giv)="en") }}
  OPTIONAL {{ ?p p:P569 ?st . ?st psv:P569 [ wikibase:timeValue ?dob ; wikibase:timePrecision ?prec ] .
    OPTIONAL {{ ?st prov:wasDerivedFrom ?r .
      OPTIONAL {{ ?r pr:P248 ?ref . ?ref rdfs:label ?refLabel FILTER(lang(?refLabel)="en") }}
      OPTIONAL {{ ?r pr:P854 ?refUrl }} }} }}
}}""")
        for r in rows:
            q = r["p"].rsplit("/", 1)[-1]
            d = out.setdefault(q, {"qid": q, "dob_values": set(), "dob_refs": {}, "aliases": set()})
            d["it"] = d.get("it") or r.get("it")
            d["en"] = d.get("en") or r.get("en")
            if r.get("links"):
                d["sitelinks"] = int(r["links"])
            if r.get("fam"):
                d["family"] = d.get("family") or r["fam"]
            if r.get("giv"):
                d["given"] = d.get("given") or r["giv"]
            if r.get("dob") and r.get("prec") == "11":
                dob = r["dob"][:10]
                d["dob_values"].add(dob)
                fam = ref_family(r.get("refLabel"), r.get("refUrl"))
                if fam:
                    d["dob_refs"].setdefault(dob, {})[fam] = r.get("refUrl") or r.get("refLabel")
        alias_rows = http.sparql(f"""
SELECT ?p ?alt WHERE {{ VALUES ?p {{ {values} }} ?p skos:altLabel ?alt FILTER(lang(?alt) IN ("it","en")) }}""")
        for r in alias_rows:
            q = r["p"].rsplit("/", 1)[-1]
            if q in out:
                out[q]["aliases"].add(r["alt"])
    for d in out.values():
        vals = d.pop("dob_values")
        refs = d.pop("dob_refs")
        if len(vals) == 1:
            dob = next(iter(vals))
            if refs.get(dob):
                d["dob"] = dob
                d["dob_refs"] = refs[dob]
        d["aliases"] = sorted(d["aliases"])
    return out


def wikidata_places(qids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(qids), 200):
        values = " ".join(f"wd:{q}" for q in qids[i:i + 200])
        rows = http.sparql(f"""
SELECT ?p ?it ?en ?links ?coord WHERE {{
  VALUES ?p {{ {values} }}
  OPTIONAL {{ ?p rdfs:label ?it FILTER(lang(?it)="it") }}
  OPTIONAL {{ ?p rdfs:label ?en FILTER(lang(?en)="en") }}
  OPTIONAL {{ ?p wikibase:sitelinks ?links }}
  OPTIONAL {{ ?p wdt:P625 ?coord }}
}}""")
        for r in rows:
            q = r["p"].rsplit("/", 1)[-1]
            d = out.setdefault(q, {"qid": q})
            d["it"] = d.get("it") or r.get("it")
            d["en"] = d.get("en") or r.get("en")
            if r.get("links"):
                d["sitelinks"] = int(r["links"])
            if r.get("coord") and "coord" not in d:
                m = re.match(r"Point\(([-\d.]+) ([-\d.]+)\)", r["coord"])
                if m:
                    d["coord"] = [float(m.group(2)), float(m.group(1))]
    return out


# --------------------------------------------------------------------------- main

def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    report: Counter = Counter()
    codes = global_name_codes()
    sb = load_statsbomb()
    editions = []
    for y in WC_YEARS:
        ed = build_edition(y, codes, sb.get(y, []), report)
        editions.append(ed)
        print(f"{y}: {len(ed['matches'])} matches, {len(ed['squads'])} squad facts", flush=True)

    person_titles, place_titles = set(), set()
    for ed in editions:
        for m in ed["matches"]:
            v = m["verified"]
            for g in v["goals"]:
                person_titles.add(g["title"])
            for lu in v["lineups"]:
                for p in lu or []:
                    person_titles.add(p["title"])
            if v.get("referee"):
                person_titles.add(v["referee"])
            for k in ("city", "stadium"):
                if v.get(k):
                    place_titles.add(v[k])
        for s in ed["squads"]:
            person_titles.add(s["title"])
            if s.get("club"):
                place_titles.add(s["club"])
    qmap = http.wp_qids(sorted(person_titles | place_titles))
    people = wikidata_people(sorted({qmap[t] for t in person_titles if t in qmap}))
    places = wikidata_places(sorted({qmap[t] for t in place_titles if t in qmap}))
    report["persons"] = len(people)
    report["persons_dob_referenced"] = sum(1 for p in people.values() if p.get("dob"))
    graph = {"editions": editions, "qids": qmap, "people": people, "places": places,
             "codes": {k: v for k, v in codes.items()}}
    (BUILD / "graph.json").write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    (BUILD / "verification_report.json").write_text(json.dumps(dict(report), indent=2), encoding="utf-8")
    print(json.dumps(dict(report), indent=2))


if __name__ == "__main__":
    main()

__all__ = ["main", "asdict"]

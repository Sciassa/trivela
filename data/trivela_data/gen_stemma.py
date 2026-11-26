"""Indovina lo Stemma (SPEC §4.15, v16): a club crest, transformed offline, and four clubs of the same league.

Reads data/static/crests.json (written by `assets build`: the football-logos logos, user's decision of SPEC §0.8, and
the licensed Commons files for the other clubs). One question per crest
and per variant that exists for it:
- notext: the SVG crest without its text elements (only when the SVG has real text and the result is clean);
- blur: the crest blurred, shapes and colours still there;
- silhouette: the filled outline from the real alpha channel (not for plain discs or boxes);
- colors: the characteristic colours as pixel bands, drawn by the app.
The wrong options are clubs of the same league with the closest standing; for the silhouette and the colours they must
also look different (another outline, other colours), else the question would have two answers.
"""

from __future__ import annotations

import json
from collections import defaultdict

from .paths import ROOT
from .tm_core import COMP_IT, L5, SRC_DATASET, TM, base, opts4

CRESTS = ROOT / "static" / "crests.json"
VARIANTS = ("notext", "blur", "silhouette", "colors")
# the domestic league of the clubs outside the five (Transfermarkt competition id), for the Copione
LEAGUE_IT = {"A1": "Bundesliga austriaca", "BE1": "Pro League belga", "KR1": "campionato croato", "TS1": "campionato ceco",
             "DK1": "Superliga danese", "GR1": "Super League greca", "NL1": "Eredivisie", "NO1": "Eliteserien norvegese",
             "PL1": "Ekstraklasa polacca", "PO1": "Primeira Liga", "RO1": "Liga I rumena", "RU1": "Premier League russa",
             "SC1": "Premiership scozzese", "SER1": "Superliga serba", "SE1": "Allsvenskan svedese", "C1": "Super League svizzera",
             "TR1": "Süper Lig turca", "UKR1": "Premier League ucraina"}
LABEL = {"notext": "senza scritte", "blur": "sfocato", "silhouette": "in silhouette", "colors": "nei suoi colori"}


def rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def palette_distance(a: list, b: list) -> float:
    """How far palette b is from palette a: each colour of a against its nearest in b, weighted by its share."""
    tot = sum(s for _, s in a) or 1
    return sum(s * min(sum((x - y) ** 2 for x, y in zip(rgb(c), rgb(d))) ** .5 for d, _ in b) for c, s in a) / tot


def iou(a: str, b: str) -> float:
    inter = sum(1 for x, y in zip(a, b) if x == y == "1")
    union = sum(1 for x, y in zip(a, b) if "1" in (x, y))
    return inter / union if union else 1.0


def generate(t: TM) -> dict[str, list[dict]]:
    if not CRESTS.exists():
        return {"stemma": []}
    crests = {int(k): v for k, v in json.loads(CRESTS.read_text(encoding="utf-8")).items()}
    # the league of a club: its last top-five season, else its domestic league (clubs met in the European cups)
    last = {}
    for lg, club, season in t.q(f"select comp, club, max(season) from ts where comp in ({','.join(repr(x) for x in L5)}) group by 1, 2"):
        if int(club) not in last or int(season) > last[int(club)][1]:
            last[int(club)] = (lg, int(season))
    league = {c: last[c][0] if c in last else t.club_league.get(c) for c in set(crests) | set(t.club_league)}
    members = defaultdict(list)
    for c, lg in league.items():
        if lg and not t.is_nation(c) and (c in last or c in crests or t.cl_weight.get(c)):
            members[lg].append(c)
    out = []
    for club, rec in sorted(crests.items()):
        lg = league.get(club)
        if not lg:
            continue
        w = t.club_weight(club)
        rivals = sorted((c for c in members[lg] if c != club), key=lambda c: (abs(t.club_weight(c) - w), c))
        # the league of the club: one of the five (the league filter, SPEC §3.4) or another one, always included
        tag = f"comp:{lg}"
        where = COMP_IT.get(lg) or LEAGUE_IT.get(lg) or "campionato estero"
        for var in VARIANTS:
            val = rec["variants"].get(var)
            if not val:
                continue
            pool = rivals
            if var == "silhouette":
                # another outline: a rival with an unknown crest is fine, one with almost the same shape is not
                pool = [c for c in rivals if not (crests.get(c, {}).get("mask") and iou(rec["mask"], crests[c]["mask"]) > 0.8)]
            if var == "colors":
                # other colours, and known ones: two red-and-black clubs would both be right
                pool = [c for c in rivals if crests.get(c, {}).get("variants", {}).get("colors")
                        and palette_distance(val, crests[c]["variants"]["colors"]) > 55 and palette_distance(crests[c]["variants"]["colors"], val) > 55]
            names = []
            for c in pool:
                n = t.club(c)
                if n not in names and n != t.club(club):
                    names.append(n)
            o = opts4(t.club(club), names[:3], f"stemma-{club}-{var}")
            if not o:
                continue
            src = ({"family": "football-logos", "label": rec["attribution"], "url": rec["page"]} if rec["source"] == "football-logos"
                   else {"family": "wikimedia", "label": f"Wikimedia Commons: {rec['attribution']}", "url": rec["page"]})
            it = base(f"stemma_{var}", (club, var), year=2025, fame=min(100, 40 + w // 8),
                      entities=[tag, t.cid(club)], sources=[src, SRC_DATASET],
                      script=f"Lo stemma {t.di(club)} ({where}), {LABEL[var]}. {rec['attribution']}.")
            it.update({"question": "Di quale squadra è questo stemma?", "variant": var,
                       "image": val if isinstance(val, str) else None, "colors": val if var == "colors" else None,
                       "original": rec["original"], "team": t.club(club), "credit": rec["attribution"],
                       "options": o[0], "correct": o[1]})
            out.append(it)
    return {"stemma": out}

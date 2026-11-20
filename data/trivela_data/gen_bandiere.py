"""Le Bandiere (SPEC §4.14): guess the team from the flags of its eleven starters, in the shape they lined up.

One real game, one side: eleven starters with a nationality each, laid out by the position Transfermarkt records for each
of them in that game (the module, when recorded, is shown at the end). Never eleven players picked from a squad. The
wrong options are clubs of the same league and season whose usual starters have the most similar mix of nationalities.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict

from .tm_core import IN_COMP, L5, POS_XY, TM, base, date_it, nat_it, opts4, season_label

PER_CLUB_SEASON = 2

# Transfermarkt nationality -> flag code of the `flag-icons` set (ISO 3166-1 alpha-2, or gb-eng & co. for the home nations)
FLAG_CODE = {
    "Spain": "es", "France": "fr", "Italy": "it", "Germany": "de", "England": "gb-eng", "Brazil": "br", "Argentina": "ar",
    "Portugal": "pt", "Netherlands": "nl", "Belgium": "be", "Senegal": "sn", "Cote d'Ivoire": "ci", "Switzerland": "ch",
    "Serbia": "rs", "Denmark": "dk", "Croatia": "hr", "Morocco": "ma", "Austria": "at", "Poland": "pl", "Uruguay": "uy",
    "Algeria": "dz", "Ghana": "gh", "Cameroon": "cm", "Sweden": "se", "Colombia": "co", "Nigeria": "ng", "Scotland": "gb-sct",
    "Japan": "jp", "Mali": "ml", "United States": "us", "Ireland": "ie", "Norway": "no", "Czech Republic": "cz",
    "Bosnia-Herzegovina": "ba", "DR Congo": "cd", "Türkiye": "tr", "Turkey": "tr", "Wales": "gb-wls", "Chile": "cl",
    "Greece": "gr", "Slovakia": "sk", "Slovenia": "si", "Albania": "al", "Tunisia": "tn", "Guinea": "gn", "Mexico": "mx",
    "Venezuela": "ve", "Korea, South": "kr", "Romania": "ro", "Jamaica": "jm", "Hungary": "hu", "Paraguay": "py",
    "Guadeloupe": "gp", "Gabon": "ga", "Northern Ireland": "gb-nir", "Kosovo": "xk", "Ukraine": "ua", "Togo": "tg",
    "Ecuador": "ec", "Iceland": "is", "Burkina Faso": "bf", "Finland": "fi", "Montenegro": "me", "Egypt": "eg",
    "Costa Rica": "cr", "Martinique": "mq", "Australia": "au", "Angola": "ao", "Canada": "ca", "Haiti": "ht", "Benin": "bj",
    "North Macedonia": "mk", "Equatorial Guinea": "gq", "Cape Verde": "cv", "Russia": "ru", "Guinea-Bissau": "gw",
    "Georgia": "ge", "Peru": "pe", "The Gambia": "gm", "Central African Republic": "cf", "Indonesia": "id", "Comoros": "km",
    "New Zealand": "nz", "Madagascar": "mg", "Mozambique": "mz", "Congo": "cg", "Armenia": "am", "French Guiana": "gf",
    "Zimbabwe": "zw", "Israel": "il", "Curacao": "cw", "South Africa": "za", "Dominican Republic": "do", "Estonia": "ee",
    "Bulgaria": "bg", "Luxembourg": "lu", "Suriname": "sr", "Mauritania": "mr", "Zambia": "zm", "Moldova": "md",
    "Kenya": "ke", "Neukaledonien": "nc", "New Caledonia": "nc", "Honduras": "hn", "Syria": "sy", "Burundi": "bi",
    "Sierra Leone": "sl", "Iran": "ir", "Qatar": "qa", "Philippines": "ph", "Malta": "mt", "Uzbekistan": "uz", "Libya": "ly",
    "Cyprus": "cy", "Chad": "td", "Jordan": "jo", "Panama": "pa", "Iraq": "iq", "Lithuania": "lt", "Liechtenstein": "li",
    "Mauritius": "mu", "Laos": "la", "China": "cn", "Niger": "ne", "Latvia": "lv", "Belarus": "by", "Bangladesh": "bd",
    "Tanzania": "tz", "Trinidad and Tobago": "tt", "St. Kitts & Nevis": "kn", "Saudi Arabia": "sa", "Faroe Islands": "fo",
    "Malaysia": "my", "Grenada": "gd", "Cuba": "cu", "Seychelles": "sc", "Guatemala": "gt", "Uganda": "ug",
    "United Arab Emirates": "ae", "Korea, North": "kp", "Kazakhstan": "kz", "Monaco": "mc", "Azerbaijan": "az",
    "Bolivia": "bo", "Eritrea": "er",
}


def flag_of(nat: str | None) -> str | None:
    return FLAG_CODE.get(nat) if nat else None


def module_of(form: str | None) -> str | None:
    """«4-3-3 Attacking» -> «4-3-3»: only the numbers of a recorded module."""
    if not form:
        return None
    head = form.split()[0]
    return head if all(p.isdigit() for p in head.split("-")) and sum(int(p) for p in head.split("-")) == 10 else None


def similarity(a: Counter, b: Counter) -> float:
    dot = sum(a[k] * b[k] for k in a)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def generate(t: TM) -> dict[str, list[dict]]:
    comps = ",".join(f"'{c}'" for c in L5)
    games = {g["gid"]: g for g in t.games(f"comp in ({comps})")}
    lu_ok = {int(r[0]) for r in t.q("select gid from g_lu_ok")}
    lineups: dict[tuple, list] = defaultdict(list)
    for gid, club, pid, pos in t.q(f"select l.gid, l.club, l.pid, l.pos from lu l join gm using(gid) where l.starter and gm.comp in ({comps})"):
        if int(gid) in lu_ok:
            lineups[(int(gid), int(club))].append((int(pid), pos))
    # the usual mix of nationalities of each club in each season (all its line-ups), for the wrong options
    mix: dict[tuple, Counter] = defaultdict(Counter)
    for (gid, club), pl in lineups.items():
        g = games[gid]
        for pid, _pos in pl:
            nat = t.players.get(pid, {}).get("nat")
            if nat:
                mix[(g["comp"], g["season"], club)][nat] += 1
    clubs_of = defaultdict(set)
    for comp, season, club in mix:
        clubs_of[(comp, season)].add(club)
    candidates = defaultdict(list)  # (comp, season, club) -> [(mean fame, gid, players)]
    for (gid, club), pl in lineups.items():
        g = games[gid]
        comp, season = g["comp"], g["season"]
        if not (club in t.big or club in t.top_clubs.get(comp, [])[:10] or (comp == "IT1" and club in t.sa_clubs[:14])):
            continue
        if len(pl) != 11 or sum(1 for _, pos in pl if pos == "Goalkeeper") != 1 or any(pos not in POS_XY for _, pos in pl):
            continue
        nats = [t.players.get(pid, {}).get("nat") for pid, _ in pl]
        if not all(flag_of(n) for n in nats):
            continue  # every starter needs a nationality and a flag
        fame = sum(t.fame(pid) for pid, _ in pl) / 11
        candidates[(comp, season, club)].append((fame, gid, pl))
    out = []
    for (comp, season, club), lst in sorted(candidates.items()):
        others = [c for c in clubs_of[(comp, season)] if c != club]
        near = sorted(others, key=lambda c: (-similarity(mix[(comp, season, club)], mix[(comp, season, c)]), c))
        wrong = [t.club(c) for c in near[:3]]
        seen_nats = set()
        made = 0
        for fame, gid, pl in sorted(lst, key=lambda x: (-x[0], x[1])):
            if made >= PER_CLUB_SEASON:
                break
            g = games[gid]
            key = tuple(sorted(t.players[pid]["nat"] for pid, _ in pl))
            if key in seen_nats:
                continue  # the same flags twice would be the same question
            seen_nats.add(key)
            o = opts4(t.club(club), wrong, f"bandiere-{gid}-{club}")
            if not o:
                break
            spread = defaultdict(list)
            for pid, pos in pl:
                spread[POS_XY[pos]].append(pid)
            players = []
            for (x, y), ps in sorted(spread.items(), key=lambda kv: (kv[0][1], kv[0][0])):
                for k, pid in enumerate(sorted(ps)):
                    xx = x if len(ps) == 1 else min(0.92, max(0.08, x + (k - (len(ps) - 1) / 2) * 0.2))
                    nat = t.players[pid]["nat"]
                    players.append({"id": t.pid(pid), "name": t.pname(pid), "nat": nat_it(nat), "flag": flag_of(nat), "x": round(xx, 3), "y": y})
            form = module_of(g["hform"] if club == g["home"] else g["aform"])
            it = base("bandiere" if comp == "IT1" else "bandiere@estero", (gid, club), year=season, fame=round(fame),
                      entities=[f"comp:{comp}", t.cid(club), *(p["id"] for p in players)], sources=[t.src_game(g)],
                      script=f"{t.club(club)} in {t.label(g)} ({t.ctx(g)}, {date_it(g['date'])})"
                             + (f", schierato con il {form}" if form else "") + ": "
                             + ", ".join(f"{p['name']} ({p['nat']})" for p in players) + ".")
            it.update({"title": t.label(g), "date": date_it(g["date"]), "competition": t.ctx(g), "season": season_label(season),
                       "league": IN_COMP[comp], "formation": form, "team": t.club(club), "players": players,
                       "options": o[0], "correct": o[1]})
            out.append(it)
            made += 1
    out.sort(key=lambda x: (-x["fame"], x["id"]))
    return {"bandiere": out}

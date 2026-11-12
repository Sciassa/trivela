"""Question generators on the Transfermarkt consolidated history (dcaribou/transfermarkt-datasets).

Verification model (SPEC §0.3): single authoritative source per domain. Transfermarkt is the
canonical source for transfers, line-ups, events, appearances, heights and birth dates.
Records with NULL/incomplete fields are discarded. Rankings and sets always declare their
scope (competition and seasons covered by the dataset) so that answers cannot be disputed.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import random
from collections import Counter, defaultdict, deque

import duckdb

from . import http
from .paths import CACHE

TM_DB = CACHE / "tm" / "transfermarkt-datasets.duckdb"
TM_DB_URL = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/transfermarkt-datasets.duckdb"
TM_DATASET = "https://github.com/dcaribou/transfermarkt-datasets"
LAST_QMAP: dict[str, str] = {}

COMP_IT = {
    "IT1": "Serie A", "CL": "Champions League", "CIT": "Coppa Italia", "SCI": "Supercoppa Italiana",
    "GB1": "Premier League", "ES1": "Liga", "L1": "Bundesliga", "FR1": "Ligue 1", "EL": "Europa League",
    "FIWC": "Mondiale", "EURO": "Europeo", "USC": "Supercoppa Europea", "UCOL": "Conference League",
}
BIG_COMPS = ("IT1", "CL", "CIT", "SCI", "EL", "USC")
POS_IT = {
    "Goalkeeper": "Portiere", "Centre-Back": "Difensore centrale", "Right-Back": "Terzino destro",
    "Left-Back": "Terzino sinistro", "Defensive Midfield": "Mediano", "Central Midfield": "Centrocampista centrale",
    "Attacking Midfield": "Trequartista", "Right Midfield": "Esterno destro di centrocampo",
    "Left Midfield": "Esterno sinistro di centrocampo", "Right Winger": "Ala destra", "Left Winger": "Ala sinistra",
    "Centre-Forward": "Prima punta", "Second Striker": "Seconda punta", "Sweeper": "Libero",
}
# pitch coordinates (x across, y from own goal) for line-up positions
POS_XY = {
    "Goalkeeper": (0.5, 0.06), "Sweeper": (0.5, 0.2), "Centre-Back": (0.5, 0.24), "Right-Back": (0.85, 0.3),
    "Left-Back": (0.15, 0.3), "Defender": (0.5, 0.26), "Defensive Midfield": (0.5, 0.42),
    "Central Midfield": (0.5, 0.52), "midfield": (0.5, 0.52), "Midfield": (0.5, 0.52), "Right Midfield": (0.85, 0.55),
    "Left Midfield": (0.15, 0.55), "Attacking Midfield": (0.5, 0.66), "Right Winger": (0.85, 0.75),
    "Left Winger": (0.15, 0.75), "Second Striker": (0.5, 0.78), "Centre-Forward": (0.5, 0.86), "Attack": (0.5, 0.84),
}
COUNTRY_IT = {
    "Italy": "Italia", "Brazil": "Brasile", "Spain": "Spagna", "France": "Francia", "England": "Inghilterra",
    "Argentina": "Argentina", "Ukraine": "Ucraina", "Russia": "Russia", "Netherlands": "Paesi Bassi",
    "Germany": "Germania", "Turkey": "Turchia", "Türkiye": "Turchia", "Greece": "Grecia", "Portugal": "Portogallo",
    "Belgium": "Belgio", "Denmark": "Danimarca", "Scotland": "Scozia", "Colombia": "Colombia", "Serbia": "Serbia",
    "Japan": "Giappone", "Sweden": "Svezia", "Poland": "Polonia", "Croatia": "Croazia", "Czech Republic": "Repubblica Ceca",
    "United States": "Stati Uniti", "Mexico": "Messico", "Romania": "Romania", "Korea, South": "Corea del Sud",
    "Norway": "Norvegia", "Nigeria": "Nigeria", "Australia": "Australia", "Switzerland": "Svizzera", "Austria": "Austria",
    "Senegal": "Senegal", "Ghana": "Ghana", "Morocco": "Marocco", "Uruguay": "Uruguay", "Cote d'Ivoire": "Costa d'Avorio",
    "Ireland": "Irlanda", "Cameroon": "Camerun", "Bosnia-Herzegovina": "Bosnia ed Erzegovina", "Algeria": "Algeria",
    "Slovakia": "Slovacchia", "Slovenia": "Slovenia", "Albania": "Albania", "Mali": "Mali", "DR Congo": "RD del Congo",
    "Wales": "Galles", "Paraguay": "Paraguay", "Tunisia": "Tunisia", "Israel": "Israele", "Georgia": "Georgia",
    "Chile": "Cile", "Hungary": "Ungheria", "Venezuela": "Venezuela", "Canada": "Canada", "Kosovo": "Kosovo",
    "Cape Verde": "Capo Verde", "South Africa": "Sudafrica", "Northern Ireland": "Irlanda del Nord",
    "Montenegro": "Montenegro", "Guinea": "Guinea", "Iceland": "Islanda", "Finland": "Finlandia", "Belarus": "Bielorussia",
    "Bulgaria": "Bulgaria", "North Macedonia": "Macedonia del Nord", "Ecuador": "Ecuador", "Peru": "Perù",
    "Egypt": "Egitto", "Iran": "Iran", "Gabon": "Gabon", "Gambia": "Gambia", "Burkina Faso": "Burkina Faso",
    "Zambia": "Zambia", "Costa Rica": "Costa Rica", "Honduras": "Honduras", "Lithuania": "Lituania", "Latvia": "Lettonia",
    "Estonia": "Estonia", "Armenia": "Armenia", "Azerbaijan": "Azerbaigian", "Kazakhstan": "Kazakistan",
    "Luxembourg": "Lussemburgo", "Moldova": "Moldavia", "Cyprus": "Cipro", "Malta": "Malta", "Uzbekistan": "Uzbekistan",
}
# grammatical article of Italian country names used as nationality adjectives are avoided: we say "di nazionalità X".


def nat_it(c: str | None) -> str:
    return COUNTRY_IT.get(c or "", c or "")


def ensure_db() -> None:
    if TM_DB.exists():
        return
    TM_DB.parent.mkdir(parents=True, exist_ok=True)
    import urllib.request
    req = urllib.request.Request(TM_DB_URL, headers={"User-Agent": http.USER_AGENT})
    with urllib.request.urlopen(req, timeout=600) as r, open(TM_DB, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)


def season_label(season: str | int) -> str:
    s = int(str(season)[:4])
    return f"{s}/{str(s + 1)[2:]}"


def fee_label(eur: float) -> str:
    if eur >= 1_000_000:
        v = eur / 1_000_000
        return f"{v:.1f}".replace(".", ",").replace(",0", "") + " mln €"
    return f"{int(round(eur / 1000))} mila €"


def window_label(d: dt.date) -> str:
    if d.month in (6, 7, 8, 9):
        return f"Estate {d.year}"
    if d.month in (12, 1, 2):
        return f"Inverno {d.year if d.month != 12 else d.year + 1}"
    return f"{['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'][d.month - 1].capitalize()} {d.year}"


WEEKDAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre",
          "novembre", "dicembre"]


def date_it(d: dt.date) -> str:
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def iid(*parts) -> str:
    import hashlib
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12]


class TM:
    def __init__(self, qmap: dict[str, str] | None = None):
        ensure_db()
        self.con = duckdb.connect(str(TM_DB), read_only=True)
        self.qmap = qmap or {}
        self.players = {int(r[0]): r for r in self.q(
            "select player_id, name, date_of_birth, country_of_citizenship, sub_position, height_in_cm, "
            "highest_market_value_in_eur, url, city_of_birth from players")}
        self.clubs = {int(r[0]): r for r in self.q("select club_id, name, domestic_competition_id, total_market_value from clubs")}
        self.club_fame = self._club_fame()
        short = defaultdict(Counter)
        for cid, name, n in self.q("""select to_club_id, to_club_name, count(*) from transfers where to_club_name is not null group by 1,2
                                       union all select from_club_id, from_club_name, count(*) from transfers where from_club_name is not null group by 1,2"""):
            if cid is not None:
                short[int(cid)][name] += n
        self.short_names = {cid: c.most_common(1)[0][0] for cid, c in short.items()}

    def q(self, sql: str, *params):
        return self.con.execute(sql, params).fetchall() if params else self.con.execute(sql).fetchall()

    def _club_fame(self) -> dict[int, float]:
        rows = self.q("select player_club_id, count(*) from appearances where competition_id in ('CL','IT1','GB1','ES1','L1','FR1') group by 1")
        return {int(r[0]): float(r[1]) for r in rows if r[0] is not None}

    # ------------------------------------------------------------- helpers
    def pid(self, player_id: int) -> str:
        return self.qmap.get(str(int(player_id))) or f"tm:p:{int(player_id)}"

    def pname(self, player_id: int) -> str:
        p = self.players.get(int(player_id))
        return p[1] if p else str(player_id)

    def fame(self, player_id: int) -> int:
        p = self.players.get(int(player_id))
        v = float(p[6] or 0) if p else 0.0
        return int(min(150, 10 * math.log10(1 + v / 100_000)) * 3) if v else 0

    def club_name(self, club_id: int | None, fallback: str | None = None) -> str:
        cid = int(club_id) if club_id else None
        c = self.clubs.get(cid) if cid else None
        name = self.short_names.get(cid) if cid else None
        name = name or (c[1] if c else None) or fallback or "?"
        return clean_club(name)

    def answer(self, player_id: int) -> dict:
        return {"kind": "entity", "ids": [self.pid(player_id)], "display": self.pname(player_id)}

    def src_player(self, player_id: int) -> dict:
        p = self.players.get(int(player_id))
        url = p[7] if p and p[7] else TM_DATASET
        return {"family": "transfermarkt", "label": f"Transfermarkt: {self.pname(player_id)}", "url": url}

    def src_game(self, game_id: int, url: str | None) -> dict:
        return {"family": "transfermarkt", "label": "Transfermarkt: tabellino", "url": url or TM_DATASET}


SUFFIXES = (" FC", " F.C.", " CFC", " AC", " SSC", " Calcio", " 1909", " 1907", " 1913", " 1919", " BC")


LONG_PREFIXES = ("Associazione Sportiva ", "Società Sportiva ", "Associazione Calcio ", "Unione Sportiva ", "Football Club ",
                 "Fußballclub ", "Idrottsföreningen ", "Futbol Kulübü ", "Futebol Clube do ", "Sport Lisboa e ")
LONG_SUFFIXES = (" S.p.A.", " Football Club", " Saudi Football Club", " Club de Fútbol", " Fútbol Club", " Calcio")


def clean_club(name: str) -> str:
    name = " ".join(name.split())
    for pre in LONG_PREFIXES:
        if name.startswith(pre) and len(name) > len(pre) + 2:
            name = name[len(pre):]
    for suf in LONG_SUFFIXES:
        if name.endswith(suf) and len(name) > len(suf) + 2:
            name = name[: -len(suf)]
    fixes = {"Inter Milan": "Inter", "AC Milan": "Milan", "Juventus FC": "Juventus", "SSC Napoli": "Napoli",
             "AS Roma": "Roma", "SS Lazio": "Lazio", "ACF Fiorentina": "Fiorentina", "Atalanta BC": "Atalanta",
             "Bologna FC 1909": "Bologna", "Torino FC": "Torino", "Genoa CFC": "Genoa", "UC Sampdoria": "Sampdoria",
             "Udinese Calcio": "Udinese", "US Sassuolo": "Sassuolo", "Cagliari Calcio": "Cagliari",
             "Hellas Verona": "Verona", "FC Barcelona": "Barcellona", "Real Madrid": "Real Madrid",
             "Atlético de Madrid": "Atlético Madrid", "Bayern Munich": "Bayern Monaco", "Paris Saint-Germain": "Paris Saint-Germain"}
    if name in fixes:
        return fixes[name]
    for s in SUFFIXES:
        if name.endswith(s) and len(name) > len(s) + 3:
            name = name[: -len(s)]
    return name.strip()


def base(gen: str, params, *, year: int, year_max: int | None = None, fame: int, entities: list[str], sources: list[dict],
         script: str, active: list[int] | None = None) -> dict:
    seen, srcs = set(), []
    for s in sources:
        if s["url"] + s["label"] not in seen:
            seen.add(s["url"] + s["label"])
            srcs.append(s)
    d = {"id": iid(gen, params), "generator": gen, "yearMin": year, "yearMax": year_max or year,
         "difficulty": 1 if fame >= 90 else 2 if fame >= 45 else 3, "fame": fame,
         "entities": sorted(set(entities)), "sources": srcs, "script": script}
    if active:
        d["activeYears"] = active
    return d


def opts4(correct: str, distractors: list[str], key: str):
    ds = [d for d in dict.fromkeys(distractors) if d and d != correct]
    if len(ds) < 3:
        return None
    r = random.Random(key)
    o = r.sample(ds, 3) + [correct]
    r.shuffle(o)
    return o, o.index(correct)


# =============================================================================== generators

def gen_mercato(t: TM, limit: int = 3000) -> list[dict]:
    rows = t.q("""
        select tr.player_id, tr.transfer_date, tr.from_club_id, tr.to_club_id, tr.from_club_name, tr.to_club_name,
               tr.transfer_fee, tr.transfer_season
        from transfers tr
        left join clubs cf on cf.club_id = tr.from_club_id
        left join clubs ct on ct.club_id = tr.to_club_id
        where tr.transfer_fee >= 1000000 and tr.transfer_date >= date '1990-07-01'
          and (cf.domestic_competition_id = 'IT1' or ct.domestic_competition_id = 'IT1')""")
    out = []
    for pid_, d, fc, tc, fn, tn, fee, season in rows:
        p = t.players.get(pid_)
        if not p or not p[3] or not p[4] or not fn or not tn:
            continue
        frm, to = t.club_name(fc, fn), t.club_name(tc, tn)
        clues = [fee_label(float(fee)), window_label(d), POS_IT.get(p[4], p[4]), nat_it(p[3]),
                 f"Club cedente: {frm}", f"Club acquirente: {to}"]
        fame = t.fame(pid_)
        it = base("tm_mercato", (pid_, str(d)), year=d.year, fame=fame,
                  entities=["comp:IT1", t.pid(pid_), f"tm:c:{fc}", f"tm:c:{tc}"],
                  sources=[t.src_player(pid_), {"family": "transfermarkt", "label": "Transfermarkt: trasferimenti (dataset)", "url": TM_DATASET}],
                  script=f"{t.pname(pid_)} passò da {frm} a {to} ({window_label(d).lower()}) per {fee_label(float(fee))}, secondo Transfermarkt.")
        it.update({"clues": clues, "flag": p[3], "answer": t.answer(pid_)})
        out.append((float(fee) * (1 + fame), it))
    out.sort(key=lambda x: -x[0])
    return [it for _, it in out[:limit]]


def big_games(t: TM, limit: int = 1500) -> list[tuple]:
    """Famous games: Champions League knockouts/finals, Italian cups, Serie A among the top clubs."""
    top = ("Juventus FC", "Inter Milan", "AC Milan", "SSC Napoli", "AS Roma", "SS Lazio", "Atalanta BC", "ACF Fiorentina")
    rows = t.q(f"""
        select game_id, competition_id, season, round, date, home_club_id, away_club_id, home_club_goals, away_club_goals,
               home_club_name, away_club_name, stadium, attendance, referee, url, home_club_formation, away_club_formation,
               home_club_manager_name, away_club_manager_name
        from games
        where home_club_goals is not null and (
              (competition_id = 'CL' and (round ilike '%final%' or round ilike '%last 16%'))
           or (competition_id in ('CIT','SCI','USC') and round ilike '%final%')
           or (competition_id = 'IT1' and home_club_name in {top} and away_club_name in {top})
           or (competition_id = 'CL' and (home_club_name in {top} or away_club_name in {top})))
        order by date desc""")
    return [(int(r[0]),) + tuple(r[1:]) for r in rows[:limit]]


def goals_of(t: TM, game_ids: list[int]) -> dict[int, list[tuple]]:
    out: dict[int, list[tuple]] = defaultdict(list)
    if not game_ids:
        return out
    ids = ",".join(map(str, game_ids))
    for gid, minute, club, player, desc in t.q(
            f"select game_id, minute, club_id, player_id, description from game_events where type='Goals' and game_id in ({ids}) order by minute"):
        own = "own-goal" in (desc or "").lower()
        out[int(gid)].append((minute, club, player, own))
    return out


def game_label(t: TM, g) -> str:
    return f"{t.club_name(g[5], g[9])}-{t.club_name(g[6], g[10])} {g[7]}-{g[8]}"


def comp_round(g) -> str:
    rnd = (g[3] or "").replace("1st leg", "andata").replace("2nd leg", "ritorno").replace("last 16", "ottavi") \
        .replace("Quarter-Finals", "quarti").replace("Semi-Finals", "semifinale").replace("Final", "finale")
    comp = COMP_IT.get(g[1], g[1])
    if g[1] == "IT1":
        return f"Serie A {season_label(g[2])}, {rnd.lower()}" if rnd else f"Serie A {season_label(g[2])}"
    return f"{comp} {season_label(g[2])}, {rnd}"


def gen_games(t: TM) -> dict[str, list[dict]]:
    games = big_games(t)
    gmap = {g[0]: g for g in games}
    goals = goals_of(t, list(gmap))
    frame, prima, cassa, ts_ref = [], [], [], []
    refs_by_season = defaultdict(set)
    for g in games:
        if g[13]:
            refs_by_season[g[2]].add(g[13])
    for gid, g in gmap.items():
        gl = goals.get(gid, [])
        total = (g[7] or 0) + (g[8] or 0)
        if len(gl) != total:
            continue  # incomplete event list: skip
        d = g[4]
        home, away = t.club_name(g[5], g[9]), t.club_name(g[6], g[10])
        side = lambda club: 0 if club == g[5] else 1  # noqa: E731
        ents = [f"comp:{g[1]}", f"tm:{g[1]}:{g[2]}", f"tm:c:{g[5]}", f"tm:c:{g[6]}"] + [t.pid(x[2]) for x in gl if x[2]]
        src = [t.src_game(gid, g[14])]
        label = game_label(t, g)
        fame = max([t.fame(x[2]) for x in gl if x[2]] or [30])
        # ---- frame
        if len(gl) >= 2:
            mins = [x[0] for x in gl]
            cands = [m for m in range(5, 86) if m not in (44, 45, 46, 47) and all(abs(m - x) >= 2 for x in mins)
                     and any(x < m for x in mins)]
            if cands:
                m = random.Random(gid).choice(cands)
                before = [x for x in gl if x[0] < m]
                sc = [sum(1 for x in before if side(x[1]) == 0), sum(1 for x in before if side(x[1]) == 1)]
                last = before[-1]
                gtxt = ", ".join(f"{x[0]}' {t.pname(x[2])}{' (aut.)' if x[3] else ''}" for x in gl if x[2])
                it = base("tm_frame", (gid, m), year=d.year, fame=fame, entities=ents, sources=src,
                          script=f"{label} ({comp_round(g)}, {date_it(d)}). Al {m}' era {sc[0]}-{sc[1]}. Gol: {gtxt}.")
                it.update({"match": f"{home}-{away} ({comp_round(g)})", "date": date_it(d), "minute": m,
                           "teams": [home, away], "scoreAt": sc})
                if last[2] and not last[3]:
                    it["lastScorer"] = t.answer(last[2])
                frame.append(it)
        # ---- cassaforte: scorer at minute; two scorers
        scorers = [x for x in gl if x[2] and not x[3]]
        for x in scorers:
            f = t.fame(x[2])
            level = 1 if f >= 100 else 2 if f >= 60 else 3
            team = home if side(x[1]) == 0 else away
            it = base("tm_cf_scorer", (gid, x[2], x[0]), year=d.year, fame=f, entities=ents, sources=src,
                      script=f"Al {x[0]}' di {label} ({comp_round(g)}) segnò {t.pname(x[2])} per {team}.")
            it.update({"level": level, "question": f"Chi segnò per {team} al {x[0]}' di {label} ({comp_round(g)})?",
                       "parts": [t.answer(x[2])]})
            cassa.append(it)
        if len(scorers) == 2 and len(gl) == 2 and scorers[0][2] != scorers[1][2]:
            it = base("tm_cf_two", gid, year=d.year, fame=min(t.fame(x[2]) for x in scorers), entities=ents, sources=src,
                      script=f"In {label} segnarono {t.pname(scorers[0][2])} e {t.pname(scorers[1][2])}.")
            it.update({"level": 3, "question": f"Chi furono i due marcatori di {label} ({comp_round(g)})? Servono entrambi.",
                       "parts": [t.answer(scorers[0][2]), t.answer(scorers[1][2])]})
            cassa.append(it)
        # ---- tiro secco: referee
        if g[13] and len(refs_by_season[g[2]]) >= 4 and (g[1] != "IT1" or random.Random(gid).random() < 0.3):
            o = opts4(g[13], sorted(refs_by_season[g[2]]), f"ref-{gid}")
            if o:
                it = base("tm_ts_referee", gid, year=d.year, fame=fame, entities=ents, sources=src,
                          script=f"{label} ({comp_round(g)}, {date_it(d)}) fu diretta da {g[13]}.")
                it.update({"question": f"Chi arbitrò {label} ({comp_round(g)})?", "options": o[0], "correct": o[1], "archetype": 2})
                ts_ref.append(it)
        # ---- prima pagina
        if scorers and (g[13] or g[11]):
            r = random.Random(gid)
            hid = r.choice(scorers)
            kind = r.choice([k for k, v in (("referee", g[13]), ("stadium", g[11])) if v])
            hidden_name = t.pname(hid[2])
            other = g[13] if kind == "referee" else g[11]
            fam = lambda pid_: "{{0}}" if pid_ == hid[2] else t.pname(pid_)  # noqa: E731
            oth = "{{1}}"
            gtxt = ", ".join(f"{x[0]}' {fam(x[2]) if x[2] else '?'}{' aut.' if x[3] else ''}" for x in gl)
            sa, sb = g[7], g[8]
            head = f"{home} batte {away} {sa}-{sb}" if sa > sb else f"{away} batte {home} {sb}-{sa}" if sb > sa else f"{home}-{away} {sa}-{sb}"
            box = [f"{home}-{away} {sa}-{sb}", f"Reti: {gtxt}"]
            if g[13]:
                box.append(f"Arbitro: {oth if kind == 'referee' else g[13]}")
            if g[11]:
                box.append(f"Stadio: {oth if kind == 'stadium' else g[11]}")
            if g[12]:
                box.append(f"Spettatori: {int(g[12]):,}".replace(",", "."))
            if g[17] and g[18]:
                box.append(f"Allenatori: {g[17]} ({home}), {g[18]} ({away})")
            page = {"masthead": "La Trivela Sportiva", "date": date_it(d), "weekday": WEEKDAYS[d.weekday()],
                    "kicker": comp_round(g), "headline": head,
                    "subhead": "Reti di " + ", ".join(dict.fromkeys(fam(x[2]) for x in gl if x[2])),
                    "body": [f"{date_it(d)}. {home} e {away} si sono affrontate"
                             f"{' allo stadio ' + (oth if kind == 'stadium' else g[11]) if g[11] else ''} ({comp_round(g)}).",
                             f"Il tabellino delle reti: {gtxt}."],
                    "boxTitle": "Il tabellino", "boxLines": box}
            s1_label = "Arbitro" if kind == "referee" else "Stadio"
            it = base("tm_prima_pagina", gid, year=d.year, fame=t.fame(hid[2]), entities=ents, sources=src,
                      script=f"{label} ({comp_round(g)}): tra i marcatori {hidden_name}; {s1_label.lower()}: {other}.")
            it.update({"page": page, "slots": [
                {"label": "Marcatore", "answer": t.answer(hid[2]), "lengthBucket": 1 if len(hidden_name) < 9 else 2 if len(hidden_name) < 16 else 3},
                {"label": s1_label, "answer": {"kind": "text", "accepted": [other], "display": other},
                 "lengthBucket": 1 if len(other) < 9 else 2 if len(other) < 16 else 3}]})
            prima.append(it)
    return {"frame": frame, "prima_pagina": prima, "cassaforte": cassa, "tiro_secco": ts_ref}


def gen_formazione(t: TM, limit: int = 600) -> list[dict]:
    games = big_games(t, 2500)
    gmap = {g[0]: g for g in games if g[15] and g[16]}
    ids = ",".join(map(str, gmap))
    lu = defaultdict(list)
    for gid, club, pid_, pos, num, cap in t.q(
            f"select game_id, club_id, player_id, position, number, team_captain from game_lineups where type='starting_lineup' and game_id in ({ids})"):
        lu[(int(gid), club)].append((pid_, pos, num, cap))
    out = []
    for gid, g in gmap.items():
        teams = []
        for club, form in ((g[5], g[15]), (g[6], g[16])):
            pl = lu.get((gid, club), [])
            if len(pl) != 11 or any(p[1] not in POS_XY for p in pl):
                break
            r = random.Random(f"{gid}-{club}")
            outfield = [p[0] for p in pl if p[1] != "Goalkeeper"]
            hidden = set(r.sample(outfield, 5))
            spread = defaultdict(list)
            for p in pl:
                spread[POS_XY[p[1]]].append(p)
            players = []
            for (x, y), ps in spread.items():
                for k, p in enumerate(ps):
                    xx = x if len(ps) == 1 else min(0.92, max(0.08, x + (k - (len(ps) - 1) / 2) * 0.18))
                    players.append({"id": t.pid(p[0]), "name": t.pname(p[0]), "number": int(p[2]) if str(p[2]).isdigit() else None,
                                    "x": xx, "y": y, "hidden": p[0] in hidden})
            teams.append({"id": f"tm:c:{club}", "name": t.club_name(club), "formation": form, "players": players})
        if len(teams) != 2:
            continue
        d = g[4]
        fame = sum(t.fame(p[0]) for k in ((gid, g[5]), (gid, g[6])) for p in lu[k]) // 22
        it = base("tm_formazione", gid, year=d.year, fame=fame,
                  entities=[f"comp:{g[1]}", f"tm:{g[1]}:{g[2]}", f"tm:c:{g[5]}", f"tm:c:{g[6]}"] + [pp["id"] for tt in teams for pp in tt["players"]],
                  sources=[t.src_game(gid, g[14])],
                  script=f"Formazioni titolari di {game_label(t, g)} ({comp_round(g)}, {date_it(d)}) secondo il tabellino Transfermarkt: moduli {g[15]} e {g[16]}.")
        it.update({"title": game_label(t, g), "date": date_it(d), "competition": comp_round(g), "teams": teams})
        out.append((fame, it))
    out.sort(key=lambda x: -x[0])
    return [it for _, it in out[:limit]]


SERIE_A_SCOPE = "Serie A dalla stagione 2012/13 alla 2025/26"


def gen_lists(t: TM) -> dict[str, list[dict]]:
    dischetto, decina, asta = [], [], []
    src = [{"family": "transfermarkt", "label": "Transfermarkt: presenze (dataset)", "url": TM_DATASET}]
    # Top scorers by nationality in Serie A
    rows = t.q("""select p.country_of_citizenship, a.player_id, sum(a.goals) g from appearances a
                  join players p using(player_id) where a.competition_id='IT1' and p.country_of_citizenship is not null
                  group by 1,2 having sum(a.goals) > 0""")
    by_nat = defaultdict(list)
    for nat, pid_, gsum in rows:
        by_nat[nat].append((pid_, int(gsum)))
    for nat, lst in by_nat.items():
        rk = ranking(t, lst)
        if rk and nat != "Italy" and rk[0]["value"] >= 15 and min(r["value"] for r in rk) >= 3:
            dischetto.append(list_item(t, "tm_top_nat_scorers", nat, f"I 10 marcatori con cittadinanza {nat_it(nat)} in Serie A",
                                       f"Gol in {SERIE_A_SCOPE} (giocatori con cittadinanza {nat_it(nat)})", "gol", rk, src, ["comp:IT1"]))
    # Top 10 tallest / most appearances per Serie A club
    clubs = t.q("""select a.player_club_id, count(distinct a.player_id) from appearances a join clubs c on c.club_id=a.player_club_id
                   where a.competition_id='IT1' group by 1 having count(distinct a.player_id) >= 40""")
    for club, _n in clubs:
        cname = t.club_name(club)
        h = t.q("""select distinct a.player_id, p.height_in_cm from appearances a join players p using(player_id)
                   where a.competition_id='IT1' and a.player_club_id=? and p.height_in_cm is not null""", club)
        rk = ranking(t, [(pid_, int(hh)) for pid_, hh in h])
        if rk and len([r for r in rk if r["rank"] == 10]) <= 3:
            dischetto.append(list_item(t, "tm_top_tall", club, f"I 10 giocatori più alti ad aver giocato nel club {cname} in Serie A",
                                       f"Altezza registrata da Transfermarkt; giocatori con almeno una presenza in {SERIE_A_SCOPE}", "cm", rk, src,
                                       ["comp:IT1", f"tm:c:{club}"]))
        ap = t.q("""select player_id, count(*) from appearances where competition_id='IT1' and player_club_id=? group by 1""", club)
        rk = ranking(t, [(pid_, int(n)) for pid_, n in ap])
        if rk:
            dischetto.append(list_item(t, "tm_top_apps", club, f"I 10 giocatori con più presenze nel club {cname} in Serie A",
                                       f"Presenze in {SERIE_A_SCOPE}", "presenze", rk, src, ["comp:IT1", f"tm:c:{club}"]))
        # sets: nationality x club
        nat = t.q("""select p.country_of_citizenship, list(distinct a.player_id) from appearances a join players p using(player_id)
                     where a.competition_id='IT1' and a.player_club_id=? and p.country_of_citizenship not in ('Italy') group by 1""", club)
        for natname, members in nat:
            n = len(members)
            if 8 <= n <= 30:
                mem = sorted(({"id": t.pid(m), "name": t.pname(m)} for m in members), key=lambda x: x["name"])
                it = base("tm_set_nat_club", (natname, club), year=2012, year_max=2026, fame=max(t.fame(m) for m in members),
                          entities=["comp:IT1", f"tm:c:{club}"] + [m["id"] for m in mem], sources=src,
                          script=f"{n} giocatori: {', '.join(m['name'] for m in mem)}.")
                it.update({"title": f"Giocatori di nazionalità {nat_it(natname)} scesi in campo con il club {cname} in Serie A",
                           "description": f"Almeno una presenza in {SERIE_A_SCOPE}.", "members": mem})
                asta.append(it)
                if 14 <= n <= 17:
                    decina.append(dict(it, id=iid("decina", it["id"])))
    # doppi ex (Serie A appearances for both clubs)
    big = [c for c, _ in sorted(clubs, key=lambda x: -t.club_fame.get(x[0], 0))[:14]]
    played = defaultdict(set)
    for club, pid_ in t.q("select distinct player_club_id, player_id from appearances where competition_id='IT1'"):
        played[club].add(pid_)
    for i, a in enumerate(big):
        for b in big[i + 1:]:
            both = played[a] & played[b]
            n = len(both)
            if not 8 <= n <= 30:
                continue
            mem = sorted(({"id": t.pid(m), "name": t.pname(m)} for m in both), key=lambda x: x["name"])
            it = base("tm_set_doppi_ex", (a, b), year=2012, year_max=2026, fame=max(t.fame(m) for m in both),
                      entities=["comp:IT1", f"tm:c:{a}", f"tm:c:{b}"] + [m["id"] for m in mem], sources=src,
                      script=f"{n} giocatori: {', '.join(m['name'] for m in mem)}.")
            it.update({"title": f"Doppi ex: giocatori scesi in campo in Serie A sia con il club {t.club_name(a)} sia con il club {t.club_name(b)}",
                       "description": f"Almeno una presenza con entrambi in {SERIE_A_SCOPE}.", "members": mem})
            asta.append(it)
            if 14 <= n <= 17:
                decina.append(dict(it, id=iid("decina", it["id"])))
    return {"dischetto": dischetto, "decina": decina, "asta": asta, "_played": played, "_big": big}


def ranking(t: TM, lst: list[tuple[int, int]]) -> list[dict] | None:
    lst = sorted(lst, key=lambda x: (-x[1], t.pname(x[0])))
    if len(lst) < 12:
        return None
    tenth = lst[9][1]
    out = []
    for pid_, v in lst:
        rank = sum(1 for _p, v2 in lst if v2 > v) + 1
        if rank > 10:
            break
        out.append({"rank": 10 if v == tenth else rank, "id": t.pid(pid_), "name": t.pname(pid_), "value": v})
    if len([r for r in out if r["rank"] == 10]) > 6:
        return None
    return out


def list_item(t: TM, gen: str, key, title: str, definition: str, unit: str, rk: list[dict], src: list[dict], ents: list[str]) -> dict:
    top3 = ", ".join(f"{r['name']} ({r['value']})" for r in rk[:3])
    it = base(gen, key, year=2012, year_max=2026, fame=60, entities=ents + [r["id"] for r in rk], sources=src,
              script=f"{title}: in testa {top3}.")
    it.update({"title": title, "definition": definition, "unit": unit, "ranking": rk, "snapshot": "2026-07-06"})
    return it


def gen_tiro_secco(t: TM) -> list[dict]:
    out = []
    src_ds = {"family": "transfermarkt", "label": "Transfermarkt (dataset)", "url": TM_DATASET}
    # birthday goals in Serie A
    rows = t.q("""select e.player_id, g.date, g.game_id, g.url, g.home_club_name, g.away_club_name, g.home_club_goals, g.away_club_goals,
                         p.date_of_birth
                  from game_events e join games g using(game_id) join players p on p.player_id=e.player_id
                  where e.type='Goals' and g.competition_id='IT1' and p.date_of_birth is not null
                    and e.description not ilike '%own-goal%'""")
    scorers = defaultdict(list)
    for r in rows:
        scorers[r[0]].append(r)
    bday = {pid_: [r for r in rs if (r[1].month, r[1].day) == (r[8].month, r[8].day)] for pid_, rs in scorers.items()}
    no_bday = [pid_ for pid_, rs in bday.items() if not rs and t.fame(pid_) >= 60]
    for pid_, rs in bday.items():
        if not rs or t.fame(pid_) < 30:
            continue
        r = rs[0]
        o = opts4(t.pname(pid_), [t.pname(x) for x in random.Random(pid_).sample(no_bday, min(12, len(no_bday)))], f"bd-{pid_}")
        if not o:
            continue
        age = r[1].year - r[8].year
        it = base("tm_ts_bday", pid_, year=r[1].year, fame=t.fame(pid_), entities=["comp:IT1", t.pid(pid_)],
                  sources=[t.src_player(pid_), t.src_game(r[2], r[3])],
                  script=f"{t.pname(pid_)} segnò in {clean_club(r[4])}-{clean_club(r[5])} {r[6]}-{r[7]} il {date_it(r[1])}, giorno del suo {age}° compleanno.")
        it.update({"question": f"Quale di questi giocatori ha segnato in Serie A proprio nel giorno del suo compleanno ({SERIE_A_SCOPE})?",
                   "options": o[0], "correct": o[1], "archetype": 1})
        out.append(it)
    # unique weekday for a big club in a Serie A season
    games = t.q("""select season, date, home_club_id, away_club_id, home_club_name, away_club_name, home_club_goals, away_club_goals, game_id, url
                   from games where competition_id='IT1' and home_club_goals is not null""")
    by = defaultdict(list)
    for g in games:
        for c in (g[2], g[3]):
            by[(g[0], c)].append(g)
    top = set(gen_top_clubs(t))
    for (season, club), gs in by.items():
        if club not in top or len(gs) < 30:
            continue
        wd = Counter(g[1].weekday() for g in gs)
        for day in (0, 1, 3):  # Monday, Tuesday, Thursday
            if wd.get(day) != 1:
                continue
            tg = next(g for g in gs if g[1].weekday() == day)
            lab = lambda g: f"{clean_club(g[4])}-{clean_club(g[5])} {g[6]}-{g[7]}"  # noqa: E731
            o = opts4(lab(tg), [lab(g) for g in gs], f"wd-{season}-{club}-{day}")
            if not o:
                continue
            it = base("tm_ts_weekday", (season, club, day), year=int(season), fame=60,
                      entities=["comp:IT1", f"tm:IT1:{season}", f"tm:c:{club}"], sources=[t.src_game(tg[8], tg[9]), src_ds],
                      script=f"Nella Serie A {season_label(season)} il club {t.club_name(club)} giocò di {WEEKDAYS[day]} solo {lab(tg)}, il {date_it(tg[1])}.")
            it.update({"question": f"Quale fu l'unica partita della Serie A {season_label(season)} che il club {t.club_name(club)} giocò di {WEEKDAYS[day]}?",
                       "options": o[0], "correct": o[1], "archetype": 1})
            out.append(it)
    # tallest among four teammates
    for club in top:
        ps = t.q("""select distinct a.player_id, p.height_in_cm from appearances a join players p using(player_id)
                    where a.competition_id='IT1' and a.player_club_id=? and p.height_in_cm is not null""", club)
        ps = [(pid_, h) for pid_, h in ps if t.fame(pid_) >= 60]
        r = random.Random(club)
        for k in range(12):
            if len(ps) < 4:
                break
            four = r.sample(ps, 4)
            hs = sorted(h for _p, h in four)
            if hs[-1] - hs[-2] < 3:
                continue
            tall = max(four, key=lambda x: x[1])
            names = [t.pname(p) for p, _ in four]
            o = opts4(t.pname(tall[0]), names, f"tall-{club}-{k}")
            if not o:
                continue
            it = base("tm_ts_tallest", (club, tuple(sorted(p for p, _ in four))), year=2012, year_max=2026, fame=60,
                      entities=["comp:IT1", f"tm:c:{club}"] + [t.pid(p) for p, _ in four], sources=[t.src_player(p) for p, _ in four],
                      script="Altezze secondo Transfermarkt: " + ", ".join(f"{t.pname(p)} {h} cm" for p, h in sorted(four, key=lambda x: -x[1])) + ".")
            it.update({"question": f"Chi è il più alto tra questi giocatori passati dal club {t.club_name(club)}?",
                       "options": o[0], "correct": o[1], "archetype": 5})
            out.append(it)
    # transfer origin
    rows = t.q("""select tr.player_id, tr.transfer_date, tr.from_club_id, tr.to_club_id, tr.from_club_name, tr.to_club_name, tr.transfer_fee
                  from transfers tr join clubs ct on ct.club_id = tr.to_club_id
                  where ct.domestic_competition_id='IT1' and tr.transfer_fee > 0""")
    sellers = defaultdict(set)
    for r in rows:
        sellers[r[3]].add(clean_club(r[4]))
    for r in rows:
        pid_ = r[0]
        if t.fame(pid_) < 70:
            continue
        frm, to = clean_club(r[4]), t.club_name(r[3], r[5])
        o = opts4(frm, sorted(sellers[r[3]]), f"from-{pid_}-{r[1]}")
        if not o:
            continue
        it = base("tm_ts_from", (pid_, str(r[1])), year=r[1].year, fame=t.fame(pid_),
                  entities=["comp:IT1", t.pid(pid_), f"tm:c:{r[3]}"], sources=[t.src_player(pid_)],
                  script=f"{t.pname(pid_)} arrivò al club {to} dal {frm} ({window_label(r[1]).lower()}) per {fee_label(float(r[6]))}.")
        it.update({"question": f"Da quale club arrivò {t.pname(pid_)} al club {to} ({window_label(r[1]).lower()})?",
                   "options": o[0], "correct": o[1], "archetype": 5})
        out.append(it)
    return out


def gen_top_clubs(t: TM) -> list[int]:
    rows = t.q("select player_club_id, count(*) from appearances where competition_id='IT1' group by 1 order by 2 desc")
    ids = [r[0] for r in rows]
    return sorted(ids, key=lambda c: -t.club_fame.get(c, 0))[:10]


def gen_giramondo(t: TM, limit: int = 1500) -> list[dict]:
    rows = t.q("""select player_id, transfer_date, to_club_id, to_club_name from transfers
                  where to_club_name is not null and to_club_name not ilike '%retired%' and to_club_name not ilike '%without club%'
                  order by player_id, transfer_date""")
    careers = defaultdict(list)
    for pid_, d, cid, cname in rows:
        careers[pid_].append((d, cid, cname))
    out = []
    for pid_, steps in careers.items():
        if t.fame(pid_) < 70:
            continue
        clubs = []
        for d, cid, cname in steps:
            name = t.club_name(cid, cname)
            if " U" in name or "Youth" in name or "B" == name[-1:]:
                continue
            if not clubs or clubs[-1][1] != name:
                clubs.append((d, name, cid))
        if len(clubs) < 5:
            continue
        ranked = sorted(clubs, key=lambda c: t.club_fame.get(c[2], 0))
        picks = ranked[:4] + [ranked[-1]]
        clues = [f"{season_label(c[0].year if c[0].month >= 7 else c[0].year - 1)}: {c[1]}" for c in picks]
        p = t.players[pid_]
        it = base("tm_giramondo", pid_, year=clubs[0][0].year, year_max=clubs[-1][0].year, fame=t.fame(pid_),
                  entities=[t.pid(pid_)] + [f"tm:c:{c[2]}" for c in clubs], sources=[t.src_player(pid_)],
                  script=f"La carriera di {t.pname(pid_)} secondo Transfermarkt: " + " → ".join(f"{c[1]} ({c[0].year})" for c in clubs) + ".",
                  active=[clubs[-1][0].year])
        it.update({"clues": clues, "answer": t.answer(pid_)})
        if p[4]:
            it["script"] += f" Ruolo: {POS_IT.get(p[4], p[4])}."
        out.append(it)
    out.sort(key=lambda x: -x["fame"])
    return out[:limit]


def gen_maglia(t: TM, limit: int = 2500) -> list[dict]:
    rows = t.q("""select g.season, l.club_id, l.player_id, l.number, count(*) n from game_lineups l join games g using(game_id)
                  where g.competition_id='IT1' and l.number is not null and l.number <> '' group by 1,2,3,4""")
    per = defaultdict(Counter)
    for season, club, pid_, num, n in rows:
        per[(season, club, pid_)][str(num)] += n
    owners = defaultdict(list)
    counts = {}
    for (season, club, pid_), c in per.items():
        num, n = c.most_common(1)[0]
        if n >= 10 and n / sum(c.values()) >= 0.8 and num.isdigit():
            owners[(season, club, num)].append(pid_)
            counts[(season, club, pid_)] = n
    out = []
    for (season, club, num), ps in owners.items():
        if len(ps) != 1:
            continue
        pid_ = ps[0]
        f = t.fame(pid_)
        if f < 45:
            continue
        it = base("tm_maglia", (season, club, num), year=int(season), fame=f,
                  entities=["comp:IT1", f"tm:IT1:{season}", f"tm:c:{club}", t.pid(pid_)], sources=[t.src_player(pid_)],
                  script=f"Nella Serie A {season_label(season)} {t.pname(pid_)} indossò il numero {num} del club {t.club_name(club)} (tabellini Transfermarkt).")
        it.update({"team": t.club_name(club), "season": f"Serie A {season_label(season)}", "number": int(num), "answer": t.answer(pid_),
                   "_n": counts[(season, club, pid_)]})
        out.append(it)
    out.sort(key=lambda x: -x["fame"])
    return out


def teammates(t: TM, played_by_club_season: bool = True) -> dict:
    groups, by_person = {}, defaultdict(list)
    rows = t.q("""select a.player_club_id, g.season, list(distinct a.player_id) from appearances a join games g using(game_id)
                  where a.competition_id='IT1' group by 1,2""")
    for club, season, members in rows:
        key = f"tm:{club}:{season}"
        groups[key] = {"label": f"{t.club_name(club)} · Serie A {season_label(season)}", "members": [t.pid(m) for m in members]}
        for m in members:
            by_person[t.pid(m)].append(key)
    return {"groups": groups, "byPerson": dict(by_person)}


def gen_filo_rosso(t: TM, tm_graph: dict, limit: int = 300) -> list[dict]:
    famous = [p for p in {pid_ for pid_ in t.players if t.pid(pid_) in tm_graph["byPerson"]} if t.fame(p) >= 75]
    famous.sort(key=lambda p: -t.fame(p))
    r = random.Random(11)
    out = []
    for src_p in famous[:200]:
        s = t.pid(src_p)
        prev = {s: None}
        dq = deque([s])
        while dq:
            u = dq.popleft()
            for grp in tm_graph["byPerson"].get(u, []):
                for v in tm_graph["groups"][grp]["members"]:
                    if v not in prev:
                        prev[v] = u
                        dq.append(v)
        targets = []
        for dst in famous:
            dd = t.pid(dst)
            if dd == s or dd not in prev:
                continue
            path = [dd]
            while prev[path[-1]] is not None:
                path.append(prev[path[-1]])
            if 3 <= len(path) - 1 <= 4:
                targets.append((dst, path[::-1]))
        if not targets:
            continue
        dst, path = r.choice(targets)
        name_of = {t.pid(k): t.pname(k) for k in t.players}
        it = base("tm_filo_rosso", (src_p, dst), year=2012, year_max=2026, fame=min(t.fame(src_p), t.fame(dst)),
                  entities=["comp:IT1"] + path, sources=[{"family": "transfermarkt", "label": "Transfermarkt: presenze Serie A", "url": TM_DATASET}],
                  script="Una catena minima: " + " → ".join(name_of.get(p, p) for p in path) + " (compagni nella stessa squadra di Serie A, stessa stagione).",
                  active=[2026, 2026])
        it.update({"from": {"id": s, "name": t.pname(src_p)}, "to": {"id": t.pid(dst), "name": t.pname(dst)}, "optimal": len(path) - 1,
                   "solution": [{"id": p, "name": name_of.get(p, p)} for p in path]})
        out.append(it)
        if len(out) >= limit:
            break
    return out


def gen_intruso(t: TM, played: dict, big: list[int], limit: int = 600) -> list[dict]:
    props = {}
    for i, a in enumerate(big):
        for b in big[i + 1:]:
            props[(a, b)] = played[a] & played[b]
    out = []
    for (a, b), both in props.items():
        famous = sorted((p for p in both if t.fame(p) >= 55), key=lambda p: -t.fame(p))[:10]
        only_a = [p for p in played[a] - played[b] if t.fame(p) >= 60]
        if len(famous) < 3 or not only_a:
            continue
        r = random.Random(f"{a}-{b}")
        for k in range(3):
            trio = r.sample(famous, 3)
            intr = r.choice(only_a)
            four = trio + [intr]
            ambiguous = any(sum(x in s for x in four) == 3 and [x in s for x in four].index(False) != 3
                            for key, s in props.items() if key != (a, b))
            if ambiguous:
                continue
            links = [f"Hanno giocato in Serie A sia con {t.club_name(x)} sia con {t.club_name(y)}"
                     for (x, y), s in props.items() if (x, y) != (a, b) and not all(p in s for p in trio)]
            correct = f"Hanno giocato in Serie A sia con {t.club_name(a)} sia con {t.club_name(b)}"
            o = opts4(correct, links, f"intr-{a}-{b}-{k}")
            if not o:
                continue
            order = trio + [intr]
            r.shuffle(order)
            it = base("tm_intruso", (a, b, k), year=2012, year_max=2026, fame=min(t.fame(p) for p in four),
                      entities=["comp:IT1", f"tm:c:{a}", f"tm:c:{b}"] + [t.pid(p) for p in four],
                      sources=[{"family": "transfermarkt", "label": "Transfermarkt: presenze Serie A", "url": TM_DATASET}],
                      script=f"{', '.join(t.pname(p) for p in trio)} hanno giocato in Serie A sia con {t.club_name(a)} sia con {t.club_name(b)} "
                             f"({SERIE_A_SCOPE}); {t.pname(intr)} solo con {t.club_name(a)}.",
                      active=[2026] * 4)
            it.update({"names": [t.pname(p) for p in order], "intruder": order.index(intr), "links": o[0], "correctLink": o[1]})
            out.append(it)
    return out[:limit]


# ------------------------------------------------------------------ Wikidata bulk (P2446 = Transfermarkt player ID)

def wikidata_by_tm(tm_ids: list[int]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    ids = sorted({str(i) for i in tm_ids})
    for i in range(0, len(ids), 300):
        values = " ".join(f'"{x}"' for x in ids[i:i + 300])
        try:
            rows = http.sparql(f"""SELECT ?tm ?item ?it ?pobIt ?coord WHERE {{
  VALUES ?tm {{ {values} }} ?item wdt:P2446 ?tm .
  OPTIONAL {{ ?item rdfs:label ?it FILTER(lang(?it)="it") }}
  OPTIONAL {{ ?item wdt:P19 ?pob . ?pob wdt:P625 ?coord . OPTIONAL {{ ?pob rdfs:label ?pobIt FILTER(lang(?pobIt)="it") }} }}
}}""")
        except RuntimeError:
            print("[wikidata] giving up on remaining chunks (rate limited)", flush=True)
            break
        for r in rows:
            d = out.setdefault(r["tm"], {"qid": r["item"].rsplit("/", 1)[-1]})
            if r.get("it"):
                d["it"] = r["it"]
            if r.get("coord") and "coord" not in d:
                import re
                m = re.match(r"Point\(([-\d.]+) ([-\d.]+)\)", r["coord"])
                if m:
                    d["coord"] = [float(m.group(2)), float(m.group(1))]
                    d["pob"] = r.get("pobIt")
    return out


def gen_birthplaces(t: TM, wd: dict[str, dict], limit: int = 800) -> dict[str, list[dict]]:
    mappa, ts = [], []
    cand = [(int(k), v) for k, v in wd.items() if v.get("coord") and v.get("pob") and int(k) in t.players]
    cand.sort(key=lambda x: -t.fame(x[0]))
    for pid_, v in cand[:limit]:
        src = [t.src_player(pid_), {"family": "wikimedia", "label": "Wikidata: luogo di nascita", "url": f"https://www.wikidata.org/wiki/{v['qid']}"}]
        it = base("tm_birthplace", pid_, year=t.players[pid_][2].year if t.players[pid_][2] else 2000, fame=t.fame(pid_),
                  entities=[t.pid(pid_)], sources=src, script=f"{t.pname(pid_)} è nato a {v['pob']}.")
        it.update({"question": f"Dove è nato {t.pname(pid_)}?", "target": {"lat": v["coord"][0], "lon": v["coord"][1], "label": v["pob"]}})
        it["yearMin"] = it["yearMax"] = 2012
        mappa.append(it)
    r = random.Random(5)
    pool = cand[:limit]
    for k in range(min(400, len(pool) // 4)):
        four = r.sample(pool, 4)
        lats = sorted(v["coord"][0] for _p, v in four)
        if lats[-1] - lats[-2] < 1.0:
            continue
        north = max(four, key=lambda x: x[1]["coord"][0])
        names = [t.pname(p) for p, _ in four]
        o = opts4(t.pname(north[0]), names, f"north-{k}")
        if not o:
            continue
        it = base("tm_ts_north", tuple(sorted(p for p, _ in four)), year=2012, year_max=2026, fame=min(t.fame(p) for p, _ in four),
                  entities=[t.pid(p) for p, _ in four],
                  sources=[{"family": "wikimedia", "label": f"Wikidata: {t.pname(p)}", "url": f"https://www.wikidata.org/wiki/{v['qid']}"} for p, v in four],
                  script="Luoghi di nascita: " + ", ".join(f"{t.pname(p)} a {v['pob']} ({v['coord'][0]:.1f}° N)" for p, v in sorted(four, key=lambda x: -x[1]["coord"][0])) + ".")
        it.update({"question": "Chi di questi giocatori è nato più a nord?", "options": o[0], "correct": o[1], "archetype": 6})
        ts.append(it)
    return {"mappamondo": mappa, "tiro_secco": ts}


# ------------------------------------------------------------------ entities

def tm_entities(t: TM, used_ids: set[str], wd: dict[str, dict]) -> list[dict]:
    ents = []
    rel = t.q("""select distinct player_id from appearances where competition_id in ('IT1','CL','GB1','ES1','L1','FR1')""")
    keep = {r[0] for r in rel}
    for pid_, p in t.players.items():
        eid = t.pid(pid_)
        if pid_ not in keep and eid not in used_ids:
            continue
        name = p[1]
        info = wd.get(str(pid_), {})
        aliases = sorted({info.get("it")} - {None, name})
        parts = name.split()
        ents.append({"id": eid, "kind": "person", "name": name, "fame": t.fame(pid_), "aliases": aliases,
                     "family": parts[-1] if len(parts) > 1 else name})
    for cid, c in t.clubs.items():
        nm = t.club_name(cid)
        ents.append({"id": f"tm:c:{cid}", "kind": "club", "name": nm, "fame": int(min(150, t.club_fame.get(cid, 0) / 20)),
                     "aliases": sorted({c[1]} - {nm})})
    for comp, name in COMP_IT.items():
        ents.append({"id": f"comp:{comp}", "kind": "competition", "name": name, "fame": 200, "aliases": []})
    for season in range(2012, 2026):
        ents.append({"id": f"tm:IT1:{season}", "kind": "edition", "name": f"Serie A {season_label(season)}", "fame": 100,
                     "years": [season], "aliases": [f"Serie A {season}/{season + 1}", f"Campionato {season_label(season)}"]})
        ents.append({"id": f"tm:CL:{season}", "kind": "edition", "name": f"Champions League {season_label(season)}", "fame": 100,
                     "years": [season], "aliases": [f"Champions {season_label(season)}"]})
    return ents


def tm_topics(t: TM) -> dict[str, list[str]]:
    nb = defaultdict(set)
    for club, season in t.q("select distinct player_club_id, cast(g.season as int) from appearances a join games g using(game_id) where a.competition_id='IT1'"):
        nb[f"tm:IT1:{season}"].add(f"tm:c:{club}")
        nb[f"tm:c:{club}"].add(f"tm:IT1:{season}")
        nb["comp:IT1"].add(f"tm:IT1:{season}")
    for s in range(2012, 2026):
        nb["comp:CL"].add(f"tm:CL:{s}")
    return {k: sorted(v) for k, v in nb.items()}


def generate_all(qmap_extra: dict[str, str] | None = None) -> tuple[dict[str, list[dict]], list[dict], dict, dict]:
    pre = TM()
    tm_ids = [pid_ for pid_ in pre.players if pre.fame(pid_) >= 45]
    wd = wikidata_by_tm(tm_ids)
    qmap = {k: v["qid"] for k, v in wd.items()}
    global LAST_QMAP
    LAST_QMAP = qmap
    if qmap_extra:
        qmap.update(qmap_extra)
    t = TM(qmap)
    packs: dict[str, list[dict]] = defaultdict(list)
    packs["mercato"] += gen_mercato(t)
    for k, v in gen_games(t).items():
        packs[k] += v
    packs["formazione"] += gen_formazione(t)
    lists = gen_lists(t)
    for k in ("dischetto", "decina", "asta"):
        packs[k] += lists[k]
    packs["tiro_secco"] += gen_tiro_secco(t)
    packs["giramondo"] += gen_giramondo(t)
    packs["maglia"] += gen_maglia(t)
    tm_graph = teammates(t)
    packs["filo_rosso"] += gen_filo_rosso(t, tm_graph)
    packs["intruso"] += gen_intruso(t, lists["_played"], lists["_big"])
    for k, v in gen_birthplaces(t, wd).items():
        packs[k] += v
    used = {e for items in packs.values() for it in items for e in it["entities"]}
    ents = tm_entities(t, used, wd)
    return dict(packs), ents, tm_graph, tm_topics(t)


if __name__ == "__main__":
    p, e, g, tp = generate_all()
    print(json.dumps({k: len(v) for k, v in p.items()}, indent=2), len(e))

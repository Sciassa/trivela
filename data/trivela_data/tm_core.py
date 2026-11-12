"""Core access layer on the Transfermarkt dataset (dcaribou/transfermarkt-datasets).

It builds a verified "facts" layer in temporary tables:

  gm    one row per game, with the score recomputed from goal events when a penalty shoot-out is recorded
  goal  goal events of games whose events match the score (minute, credited club, scorer, own goal, header, penalty)
  pg    goals per player per game (from events; from the appearances table when events are incomplete but appearances add up)
  pres  who took the field (starting line-up + substitutes who came on; appearances table as fallback)
  lu    line-ups (starters and bench) with shirt number, position and captain flag

A game is "goal-complete" / "presence-complete" only when the sources add up exactly; rankings and sets are
generated only on scopes (club, competition, seasons) made entirely of complete games.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import math
import random
import re
import unicodedata
import urllib.request
from collections import Counter, defaultdict

import duckdb

from .paths import CACHE

TM_DB = CACHE / "tm" / "transfermarkt-datasets.duckdb"
TM_DB_URL = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/transfermarkt-datasets.duckdb"
TM_DATASET = "https://github.com/dcaribou/transfermarkt-datasets"
USER_AGENT = "TrivelaQuizBot/0.5 (non-commercial football quiz pipeline)"
SNAPSHOT = "2026-07-06"

L5 = ("IT1", "GB1", "ES1", "L1", "FR1")
COMPS = L5 + ("CL", "EL", "UCOL", "CIT", "SCI", "USC", "FIWC", "EURO")
COMP_IT = {"IT1": "Serie A", "GB1": "Premier League", "ES1": "Liga", "L1": "Bundesliga", "FR1": "Ligue 1",
           "CL": "Champions League", "EL": "Europa League", "UCOL": "Conference League", "CIT": "Coppa Italia",
           "SCI": "Supercoppa Italiana", "USC": "Supercoppa Europea", "FIWC": "Mondiale", "EURO": "Europeo"}
IN_COMP = {"IT1": "in Serie A", "GB1": "in Premier League", "ES1": "nella Liga", "L1": "in Bundesliga", "FR1": "in Ligue 1",
           "CL": "in Champions League", "EL": "in Europa League", "UCOL": "in Conference League", "CIT": "in Coppa Italia",
           "SCI": "in Supercoppa Italiana", "USC": "in Supercoppa Europea", "FIWC": "ai Mondiali", "EURO": "agli Europei"}
OF_COMP = {"IT1": "della Serie A", "GB1": "della Premier League", "ES1": "della Liga", "L1": "della Bundesliga",
           "FR1": "della Ligue 1", "CL": "della Champions League", "EL": "dell'Europa League",
           "UCOL": "della Conference League", "CIT": "della Coppa Italia"}

POS_IT = {
    "Goalkeeper": "Portiere", "Centre-Back": "Difensore centrale", "Right-Back": "Terzino destro",
    "Left-Back": "Terzino sinistro", "Defensive Midfield": "Mediano", "Central Midfield": "Centrocampista centrale",
    "Attacking Midfield": "Trequartista", "Right Midfield": "Esterno destro di centrocampo",
    "Left Midfield": "Esterno sinistro di centrocampo", "Right Winger": "Ala destra", "Left Winger": "Ala sinistra",
    "Centre-Forward": "Prima punta", "Second Striker": "Seconda punta", "Sweeper": "Libero",
}
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
    "Saudi Arabia": "Arabia Saudita", "Qatar": "Qatar", "Panama": "Panama", "Jamaica": "Giamaica", "Togo": "Togo",
    "Angola": "Angola", "New Zealand": "Nuova Zelanda", "Korea, North": "Corea del Nord", "Bolivia": "Bolivia",
    "Trinidad and Tobago": "Trinidad e Tobago", "Jordan": "Giordania", "Curacao": "Curaçao", "Haiti": "Haiti",
    "Iraq": "Iraq", "Zimbabwe": "Zimbabwe", "Guinea-Bissau": "Guinea-Bissau", "Benin": "Benin", "Congo": "Congo",
    "Equatorial Guinea": "Guinea Equatoriale", "Mozambique": "Mozambico", "Libya": "Libia", "Suriname": "Suriname",
}
WEEKDAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre",
          "novembre", "dicembre"]

# ---- Italian grammar for team names
FEM_CLUBS = {"Juventus", "Roma", "Lazio", "Fiorentina", "Sampdoria", "Salernitana", "Cremonese", "SPAL", "Real Sociedad",
             "Reggina", "Ternana", "Stella Rossa", "Dinamo Zagabria", "Dinamo Kiev"}
MASC_NATIONS = {"Brasile", "Belgio", "Portogallo", "Messico", "Giappone", "Marocco", "Senegal", "Ghana", "Camerun", "Cile",
                "Perù", "Paraguay", "Canada", "Galles", "Qatar", "Sudafrica", "Togo", "Venezuela", "Mali", "Burkina Faso",
                "Kosovo", "Montenegro", "Lussemburgo", "Kazakistan", "Gabon", "Gambia", "Capo Verde", "Zambia", "Suriname",
                "Mozambico", "Benin", "Congo", "Zimbabwe", "Uruguay", "Ecuador", "Egitto", "Iran", "Iraq", "Honduras",
                "Uzbekistan", "Azerbaigian", "Israele", "Panama", "Haiti", "Curaçao", "Cipro", "Malta", "Trinidad e Tobago"}
NO_ARTICLE = {"Israele", "Panama", "Haiti", "Curaçao", "Cipro", "Malta", "Trinidad e Tobago", "Capo Verde", "San Marino"}
PLURALS = {"Paesi Bassi": "m", "Stati Uniti": "m", "Emirati Arabi Uniti": "m"}
_FORMS = {  # (kind) -> (m sing, m sing + s-impure, vowel, f sing, m plur, m plur vowel/s-impure, none)
    "di": ("del ", "dello ", "dell'", "della ", "dei ", "degli ", "di "),
    "a": ("al ", "allo ", "all'", "alla ", "ai ", "agli ", "a "),
    "con": ("con il ", "con lo ", "con l'", "con la ", "con i ", "con gli ", "con "),
    "il": ("il ", "lo ", "l'", "la ", "i ", "gli ", ""),
    "da": ("dal ", "dallo ", "dall'", "dalla ", "dai ", "dagli ", "da "),
    "in": ("nel ", "nello ", "nell'", "nella ", "nei ", "negli ", "in "),
}


def _plain(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def articled(kind: str, name: str, nation: bool = False) -> str:
    """Italian articulated preposition + team name: articled('di', 'Inter') -> "dell'Inter"."""
    f = _FORMS[kind]
    low = _plain(name)
    vowel = low[:1] in "aeiou"
    s_impure = bool(re.match(r"(s[^aeiou]|z|ps|gn|x)", low)) and not name.isupper()
    if name in NO_ARTICLE:
        return f[6] + name
    if name in PLURALS:
        return (f[5] if vowel or s_impure else f[4]) + name
    if vowel:
        return f[2] + name
    fem = (name not in MASC_NATIONS) if nation else (name in FEM_CLUBS)
    if fem:
        return f[3] + name
    return (f[1] if s_impure else f[0]) + name


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s).split())


def slug(s: str) -> str:
    return norm(s).replace(" ", "-")


def nat_it(c: str | None) -> str:
    return COUNTRY_IT.get(c or "", c or "")


def season_label(season: int | str) -> str:
    s = int(str(season)[:4])
    return f"{s}/{str(s + 1)[2:]}"


def date_it(d: dt.date) -> str:
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


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
    return f"{MONTHS[d.month - 1].capitalize()} {d.year}"


def age_label(dob: dt.date, on: dt.date) -> tuple[int, str]:
    """(age in days, 'N anni e M giorni')."""
    years = on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))
    try:
        last = dob.replace(year=dob.year + years)
    except ValueError:
        last = dob.replace(year=dob.year + years, day=28)
    days = (on - last).days
    return (on - dob).days, f"{years} anni e {days} giorni"


def iid(*parts) -> str:
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12]


LONG_PREFIXES = ("Associazione Sportiva ", "Società Sportiva ", "Associazione Calcio ", "Unione Sportiva ", "Football Club ",
                 "Fußballclub ", "Idrottsföreningen ", "Futbol Kulübü ", "Futebol Clube do ", "Sport Lisboa e ")
LONG_SUFFIXES = (" S.p.A.", " Football Club", " Saudi Football Club", " Club de Fútbol", " Fútbol Club", " Calcio")
SUFFIXES = (" FC", " F.C.", " CFC", " AC", " SSC", " Calcio", " 1909", " 1907", " 1913", " 1919", " BC")
CLUB_FIXES = {
    "Inter Milan": "Inter", "AC Milan": "Milan", "Juventus FC": "Juventus", "SSC Napoli": "Napoli", "AS Roma": "Roma",
    "SS Lazio": "Lazio", "ACF Fiorentina": "Fiorentina", "Atalanta BC": "Atalanta", "Bologna FC 1909": "Bologna",
    "Torino FC": "Torino", "Genoa CFC": "Genoa", "UC Sampdoria": "Sampdoria", "Udinese Calcio": "Udinese",
    "US Sassuolo": "Sassuolo", "Cagliari Calcio": "Cagliari", "Hellas Verona": "Verona", "FC Barcelona": "Barcellona",
    "Atlético de Madrid": "Atlético Madrid", "Bayern Munich": "Bayern Monaco", "US Lecce": "Lecce", "Parma Calcio 1913": "Parma",
    "Empoli FC": "Empoli", "AC Monza": "Monza", "Spezia Calcio": "Spezia", "US Salernitana 1919": "Salernitana",
    "US Cremonese": "Cremonese", "Frosinone Calcio": "Frosinone", "Venezia FC": "Venezia", "Como 1907": "Como",
    "Chievo Verona": "Chievo", "US Palermo": "Palermo", "Palermo FC": "Palermo", "Benevento Calcio": "Benevento",
    "FC Crotone": "Crotone", "Delfino Pescara 1936": "Pescara", "Carpi FC 1909": "Carpi", "Catania FC": "Catania",
    "AC Siena": "Siena", "AS Livorno": "Livorno", "AC Cesena": "Cesena", "Brescia Calcio": "Brescia", "SPAL": "SPAL",
    "Pisa Sporting Club": "Pisa", "Olympique Marseille": "Marsiglia", "Olympique Lyon": "Lione", "AS Monaco": "Monaco",
    "Sevilla FC": "Siviglia", "Bayer 04 Leverkusen": "Bayer Leverkusen", "Tottenham Hotspur": "Tottenham",
    "VfB Stuttgart": "Stoccarda", "Eintracht Frankfurt": "Eintracht Francoforte", "Red Bull Salzburg": "Salisburgo",
    "FC Porto": "Porto", "SL Benfica": "Benfica", "Sporting CP": "Sporting Lisbona", "Ajax Amsterdam": "Ajax",
    "Stade Rennais FC": "Rennes", "OGC Nice": "Nizza", "LOSC Lille": "Lille", "RC Lens": "Lens",
    "Borussia Mönchengladbach": "Borussia Mönchengladbach", "RasenBallsport Leipzig": "Lipsia", "RB Leipzig": "Lipsia",
    # short names used by the transfers table
    "Man City": "Manchester City", "Man Utd": "Manchester United", "Dortmund": "Borussia Dortmund", "Leverkusen": "Bayer Leverkusen",
    "Leipzig": "Lipsia", "Atlético": "Atlético Madrid", "Barcelona": "Barcellona", "FC Empoli": "Empoli",
    "Frankfurt": "Eintracht Francoforte", "Mönchengladbach": "Borussia Mönchengladbach", "Stade Rennais": "Rennes",
    "Marseille": "Marsiglia", "Lyon": "Lione", "Stade Brestois": "Brest", "FC Schalke 04": "Schalke 04", "Sevilla": "Siviglia",
    "Athletic Club": "Athletic Bilbao", "Sporting": "Sporting Lisbona", "Olympiacos": "Olympiakos", "Red Star": "Stella Rossa",
    "Shakhtar D.": "Shakhtar Donetsk", "Zenit S-Pb": "Zenit", "Salzburg": "Salisburgo", "Copenhagen": "Copenaghen",
    "CSKA Moscow": "CSKA Mosca", "Dinamo Zagreb": "Dinamo Zagabria", "Dynamo Kyiv": "Dinamo Kiev", "Basel": "Basilea",
    "RSC Anderlecht": "Anderlecht", "Loko Moscow": "Lokomotiv Mosca", "Spartak Moscow": "Spartak Mosca", "Slavia Praha": "Slavia Praga",
    "Sparta Prague": "Sparta Praga", "Slo. Bratislava": "Slovan Bratislava", "Stuttgart": "Stoccarda", "KAA Gent": "Gent",
    "M. Tel Aviv": "Maccabi Tel Aviv", "Legia Warszawa": "Legia Varsavia", "Austria Vienna": "Austria Vienna", "Nice": "Nizza",
    "Celta de Vigo": "Celta Vigo", "CA Osasuna": "Osasuna", "Granada CF": "Granada", "RCD Mallorca": "Maiorca",
    "Real Valladolid": "Valladolid", "SD Eibar": "Eibar", "Málaga CF": "Malaga", "Mainz": "Magonza", "1.FC Köln": "Colonia",
    "Hamburg": "Amburgo", "F. Düsseldorf": "Fortuna Düsseldorf", "FC Nantes": "Nantes", "Angers SCO": "Angers",
    "G. Bordeaux": "Bordeaux", "FC Lorient": "Lorient", "R. Strasbourg": "Strasburgo", "FC Metz": "Metz", "SC Bastia": "Bastia",
    "Werder Bremen": "Werder Brema", "Freiburg": "Friburgo", "Wolves": "Wolverhampton", "West Brom": "West Bromwich",
    "Bayern Munich ": "Bayern Monaco", "Hellas Verona ": "Verona", "NK Maribor": "Maribor", "FC Sheriff": "Sheriff Tiraspol",
    "FC Astana": "Astana", "Arm. Bielefeld": "Arminia Bielefeld", "1.FC Nuremberg": "Norimberga", "Elche CF": "Elche",
    "Cádiz CF": "Cadice", "Bayern": "Bayern Monaco", "Hertha BSC": "Hertha Berlino", "Hannover 96": "Hannover",
    "VfL Bochum": "Bochum", "Stade Reims": "Reims", "Saint-Étienne": "Saint-Étienne", "Legia Warsaw": "Legia Varsavia", "APOEL Nicosia": "APOEL", "Royal Antwerp": "Anversa", "AEK Athens": "AEK Atene",
}


def clean_club(name: str) -> str:
    name = " ".join((name or "").split())
    if name in CLUB_FIXES:
        return CLUB_FIXES[name]
    for pre in LONG_PREFIXES:
        if name.startswith(pre) and len(name) > len(pre) + 2:
            name = name[len(pre):]
    for suf in LONG_SUFFIXES:
        if name.endswith(suf) and len(name) > len(suf) + 2:
            name = name[: -len(suf)]
    if name in CLUB_FIXES:
        return CLUB_FIXES[name]
    for s in SUFFIXES:
        if name.endswith(s) and len(name) > len(s) + 3:
            name = name[: -len(s)]
    return name.strip()


def ensure_db() -> None:
    if TM_DB.exists():
        return
    TM_DB.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(TM_DB_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=600) as r, open(TM_DB, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)


def opts4(correct: str, distractors: list[str], key: str):
    """4 shuffled options with the correct one; None if fewer than 3 valid distractors."""
    ds = [d for d in dict.fromkeys(distractors) if d and d != correct]
    if len(ds) < 3:
        return None
    r = random.Random(key)
    o = r.sample(ds, 3) + [correct]
    r.shuffle(o)
    return o, o.index(correct)


def base(gen: str, params, *, year: int, year_max: int | None = None, fame: int, entities: list[str], sources: list[dict],
         script: str, active: list[int] | None = None) -> dict:
    seen, srcs = set(), []
    for s in sources:
        if s["url"] + s["label"] not in seen:
            seen.add(s["url"] + s["label"])
            srcs.append(s)
    d = {"id": iid(gen, params), "generator": gen, "yearMin": year, "yearMax": year_max or year,
         "difficulty": 1 if fame >= 85 else 2 if fame >= 65 else 3, "fame": fame,
         "entities": sorted(set(entities)), "sources": srcs[:4], "script": script}
    if active:
        d["activeYears"] = active
    return d


SRC_DATASET = {"family": "transfermarkt", "label": "Transfermarkt (dataset pubblico, dati al 6 luglio 2026)", "url": TM_DATASET}


class TM:
    def __init__(self):
        ensure_db()
        self.db = duckdb.connect(str(TM_DB), read_only=True)
        self._facts()
        self._people()
        self._clubs()

    def q(self, sql: str, *params):
        return self.db.execute(sql, params).fetchall() if params else self.db.execute(sql).fetchall()

    # ------------------------------------------------------------------ facts layer
    def _facts(self) -> None:
        c = self.db
        comps = ",".join(f"'{x}'" for x in COMPS)
        c.execute(f"""create temp table g0 as select cast(game_id as bigint) gid, competition_id comp, cast(season as int) season, round,
            date, home_club_id home, away_club_id away, home_club_goals hg, away_club_goals ag, home_club_name hname, away_club_name aname,
            stadium, attendance, referee, url, home_club_formation hform, away_club_formation aform,
            home_club_manager_name hman, away_club_manager_name aman
            from games where competition_id in ({comps}) and home_club_goals is not null and home_club_id is not null and away_club_id is not null""")
        c.execute("""create temp table ev as select cast(game_id as bigint) gid, minute, type, club_id club, player_id pid, description descr,
            player_in_id pin from game_events where cast(game_id as bigint) in (select gid from g0)""")
        c.execute("""create temp table goal0 as select gid, minute, club, pid, descr ilike '%own-goal%' own, descr ilike '%header%' header,
            descr ilike '%penalty%' pen, descr ilike '%left-footed%' lf from ev where type = 'Goals'""")
        # score check: events vs recorded score; penalty shoot-outs are summed into the recorded score, so recompute from events
        c.execute("""create temp table gchk as
            select g.gid, count(e.gid) n_ev, count(e.gid) filter (where e.club = g.home) eh, count(e.gid) filter (where e.club = g.away) ea,
                   count(e.gid) filter (where e.pid is null) n_null, max(g.hg) hg, max(g.ag) ag,
                   exists(select 1 from ev s where s.gid = g.gid and s.type = 'Shootout') so
            from g0 g left join goal0 e on e.gid = g.gid group by g.gid""")
        c.execute("""create temp table gm as select g.*, k.so pens,
              case when k.so then k.eh else g.hg end fh, case when k.so then k.ea else g.ag end fa,
              (k.n_null = 0 and ((not k.so and k.eh = g.hg and k.ea = g.ag) or (k.so and k.eh = k.ea))) ev_ok
            from g0 g join gchk k using(gid)""")
        c.execute("create temp table goal as select e.* from goal0 e join gm using(gid) where gm.ev_ok")
        # goals per player per game: events when complete, otherwise the appearances table if it adds up with the score
        c.execute("""create temp table apx as select cast(a.game_id as bigint) gid, a.player_id pid, a.player_club_id club, a.goals, a.assists,
            a.yellow_cards yc, a.red_cards rc, a.minutes_played mins from appearances a where cast(a.game_id as bigint) in (select gid from g0)""")
        c.execute("""create temp table apchk as select gm.gid, coalesce(sum(a.goals), 0) + (select count(*) from goal0 o where o.gid = gm.gid and o.own) tot,
            count(a.pid) n from gm left join apx a using(gid) group by gm.gid""")
        c.execute("""create temp table pg as
            select gid, pid, club, count(*) goals from goal where not own group by 1, 2, 3
            union all
            select a.gid, a.pid, a.club, a.goals from apx a join gm using(gid) join apchk k using(gid)
            where not gm.ev_ok and not gm.pens and k.tot = gm.hg + gm.ag and a.goals > 0""")
        c.execute("""create temp table g_goal_ok as select gm.gid from gm join apchk k using(gid)
            where gm.ev_ok or (not gm.pens and k.tot = gm.hg + gm.ag)""")
        # line-ups and presences
        c.execute("""create temp table lu as select cast(game_id as bigint) gid, club_id club, player_id pid, type = 'starting_lineup' starter,
            position pos, try_cast(number as int) num, team_captain = 1 cap, player_name pname
            from game_lineups where cast(game_id as bigint) in (select gid from g0)""")
        c.execute("""create temp table luchk as select gm.gid,
            count(l.pid) filter (where l.starter and l.club = gm.home) sh, count(l.pid) filter (where l.starter and l.club = gm.away) sa
            from gm left join lu l using(gid) group by gm.gid""")
        c.execute("create temp table sub as select gid, minute, club, pid pout, pin from ev where type = 'Substitutions' and pin is not null")
        c.execute("""create temp table pres as
            select l.gid, l.pid, l.club, true starter from lu l join luchk k using(gid) where l.starter and k.sh = 11 and k.sa = 11
            union
            select s.gid, s.pin, s.club, false from sub s join luchk k using(gid) where k.sh = 11 and k.sa = 11
            union
            select a.gid, a.pid, a.club, null from apx a join luchk k using(gid) join apchk c2 using(gid)
            where not (k.sh = 11 and k.sa = 11) and c2.n >= 22""")
        c.execute("""create temp table g_pres_ok as select k.gid from luchk k join apchk c2 using(gid)
            where (k.sh = 11 and k.sa = 11) or c2.n >= 22""")
        c.execute("create temp table g_lu_ok as select gid from luchk where sh = 11 and sa = 11")
        c.execute("""create temp table red as select gid, minute, club, pid from ev
            where type = 'Cards' and (descr ilike 'Red card%' or descr ilike 'Second yellow%') and pid is not null""")
        # team-season validity
        c.execute("""create temp table ts as
            select comp, season, club, count(*) n, count(gg.gid) n_goal, count(gp.gid) n_pres, count(gl.gid) n_lu, count(*) filter (where ev_ok) n_ev
            from (select gid, comp, season, home club, ev_ok from gm union all select gid, comp, season, away, ev_ok from gm) x
            left join g_goal_ok gg using(gid) left join g_pres_ok gp using(gid) left join g_lu_ok gl using(gid) group by 1, 2, 3""")

    def valid_seasons(self, comp: str, club: int | None, kind: str) -> dict[int, bool]:
        """season -> all games complete for `kind` in ('goal','pres','lu','ev'); club None = whole competition."""
        col = {"goal": "n_goal", "pres": "n_pres", "lu": "n_lu", "ev": "n_ev"}[kind]
        if club is None:
            rows = self.q(f"select season, sum(n) = sum({col}) from ts where comp = ? group by 1", comp)
        else:
            rows = self.q(f"select season, n = {col} from ts where comp = ? and club = ?", comp, club)
        return {int(s): bool(ok) for s, ok in rows}

    def window(self, comp: str, club: int | None, kind: str, min_seasons: int = 3) -> tuple[int, int] | None:
        """Longest range of seasons with no incomplete season inside (seasons without games are neutral)."""
        v = self.valid_seasons(comp, club, kind)
        if not v:
            return None
        best = None
        run: list[int] = []
        for s in range(min(v), max(v) + 1):
            if v.get(s, True):
                if s in v:
                    run.append(s)
            else:
                run = []
            if run and (best is None or len(run) > len(best)):
                best = list(run)
        if not best or len(best) < min_seasons:
            return None
        return best[0], best[-1]

    # ------------------------------------------------------------------ people
    def _people(self) -> None:
        self.players = {}
        for r in self.q("""select player_id, name, first_name, last_name, date_of_birth, country_of_citizenship, sub_position, position,
                           height_in_cm, highest_market_value_in_eur, url from players"""):
            self.players[int(r[0])] = {"name": r[1], "first": r[2], "last": r[3], "dob": r[4].date() if r[4] else None, "nat": r[5],
                                       "pos": r[6], "line": r[7], "height": r[8], "mv": float(r[9] or 0), "url": r[10]}
        self.lu_names = {int(a): b for a, b in self.q("select pid, mode(pname) from lu where pname is not null group by 1")}
        stats = {int(a): (int(b), int(c or 0)) for a, b, c in self.q(
            """select p.pid, count(distinct p.gid), coalesce((select sum(goals) from pg where pg.pid = p.pid and pg.gid in
                   (select gid from gm where comp in ('IT1','GB1','ES1','L1','FR1','CL','FIWC','EURO'))), 0)
               from pres p join gm using(gid) where gm.comp in ('IT1','GB1','ES1','L1','FR1','CL','FIWC','EURO') group by 1""")}
        self.apps = {k: v[0] for k, v in stats.items()}
        self.goals_total = {k: v[1] for k, v in stats.items()}
        self.notable = {pid for pid, p in self.players.items()
                        if p["mv"] >= 10_000_000 or self.apps.get(pid, 0) >= 80 or self.goals_total.get(pid, 0) >= 20}

    def known(self, pid) -> bool:
        return pid is not None and int(pid) in self.players

    def pname(self, pid) -> str:
        p = self.players.get(int(pid))
        return p["name"] if p else self.lu_names.get(int(pid), f"#{pid}")

    def surname(self, pid) -> str:
        p = self.players.get(int(pid))
        if p and p["last"]:
            return p["last"]
        return self.pname(pid).split()[-1]

    def fame(self, pid) -> int:
        p = self.players.get(int(pid))
        mv = p["mv"] if p else 0
        f = 30 * math.log10(1 + mv / 100_000) if mv else 0
        return int(min(100, f + min(15, self.apps.get(int(pid), 0) / 25)))

    def is_notable(self, pid) -> bool:
        return pid is not None and int(pid) in self.notable

    def pid(self, pid) -> str:
        return f"tm:p:{int(pid)}"

    def answer(self, pid) -> dict:
        return {"kind": "entity", "ids": [self.pid(pid)], "display": self.pname(pid)}

    def src_player(self, pid) -> dict:
        p = self.players.get(int(pid))
        return {"family": "transfermarkt", "label": f"Transfermarkt: {self.pname(pid)}", "url": (p or {}).get("url") or TM_DATASET}

    @staticmethod
    def src_game(g: dict) -> dict:
        return {"family": "transfermarkt", "label": "Transfermarkt: tabellino della partita", "url": g.get("url") or TM_DATASET}

    @staticmethod
    def mid(name: str) -> str:
        return f"tm:m:{slug(name)}"

    @staticmethod
    def rid(name: str) -> str:
        return f"tm:r:{slug(name)}"

    # ------------------------------------------------------------------ clubs
    def _clubs(self) -> None:
        short = defaultdict(Counter)
        for cid, name, n in self.q("""select to_club_id, to_club_name, count(*) from transfers where to_club_name is not null group by 1, 2
                                      union all select from_club_id, from_club_name, count(*) from transfers where from_club_name is not null group by 1, 2"""):
            if cid is not None:
                short[int(cid)][name] += n
        self.short_names = {cid: c.most_common(1)[0][0] for cid, c in short.items()}
        self.game_names = {}
        for cid, name in self.q("select home, mode(hname) from gm where hname is not null group by 1"):
            self.game_names[int(cid)] = name
        self.nations = {int(a): COUNTRY_IT.get(b, b) for a, b in self.q("select national_team_id, name from national_teams")}
        self.club_league = {int(a): b for a, b in self.q("select club_id, domestic_competition_id from clubs")}
        fame = {int(a): int(b) for a, b in self.q("select club, count(*) from pres join gm using(gid) where comp = 'CL' group by 1")}
        self.cl_weight = fame
        seasons = defaultdict(dict)
        for comp, club, n in self.q("select comp, club, count(distinct season) from ts group by 1, 2"):
            seasons[comp][int(club)] = int(n)
        self.seasons_in = seasons
        self.sa_clubs = sorted((c for c, n in seasons["IT1"].items() if n >= 3), key=lambda c: -self.club_weight(c))
        self.top_clubs = {lg: sorted((c for c, n in seasons[lg].items() if n >= 8), key=lambda c: -self.club_weight(c))[:12] for lg in L5}
        self.big = set(self.top_clubs["IT1"][:8]) | {c for lg in L5 if lg != "IT1" for c in self.top_clubs[lg][:6]}

    def club_weight(self, cid: int) -> int:
        lg = self.club_league.get(int(cid))
        return self.cl_weight.get(int(cid), 0) + 20 * self.seasons_in.get(lg, {}).get(int(cid), 0)

    def is_nation(self, cid) -> bool:
        return int(cid) in self.nations

    def club(self, cid, fallback: str | None = None) -> str:
        cid = int(cid)
        if cid in self.nations:
            return self.nations[cid]
        name = self.short_names.get(cid) or self.game_names.get(cid) or fallback or f"club {cid}"
        return COUNTRY_IT.get(name) or clean_club(name)

    def di(self, cid) -> str:
        return articled("di", self.club(cid), self.is_nation(cid))

    def a(self, cid) -> str:
        return articled("a", self.club(cid), self.is_nation(cid))

    def con(self, cid) -> str:
        return articled("con", self.club(cid), self.is_nation(cid))

    def il(self, cid) -> str:
        return articled("il", self.club(cid), self.is_nation(cid))

    def da(self, cid) -> str:
        return articled("da", self.club(cid), self.is_nation(cid))

    def cid(self, cid) -> str:
        return f"tm:c:{int(cid)}"

    # ------------------------------------------------------------------ games
    GCOLS = ["gid", "comp", "season", "round", "date", "home", "away", "hg", "ag", "hname", "aname", "stadium", "attendance", "referee",
             "url", "hform", "aform", "hman", "aman", "pens", "fh", "fa", "ev_ok"]

    def games(self, where: str = "true", *params) -> list[dict]:
        rows = self.q(f"select {', '.join(self.GCOLS)} from gm where {where}", *params)
        return [dict(zip(self.GCOLS, r)) for r in rows]

    def label(self, g: dict) -> str:
        return f"{self.club(g['home'], g['hname'])}-{self.club(g['away'], g['aname'])} {g['fh']}-{g['fa']}"

    def teams(self, g: dict) -> str:
        return f"{self.club(g['home'], g['hname'])}-{self.club(g['away'], g['aname'])}"

    def ctx(self, g: dict) -> str:
        comp, rnd = g["comp"], (g["round"] or "")
        if comp in ("FIWC", "EURO"):
            return f"{COMP_IT[comp]} {g['date'].year}, {round_it(rnd)}"
        m = re.match(r"(\d+)\. Matchday", rnd)
        if comp in L5 and m:
            return f"{COMP_IT[comp]} {season_label(g['season'])}, {m.group(1)}ª giornata"
        r = round_it(rnd)
        return f"{COMP_IT[comp]} {season_label(g['season'])}" + (f", {r}" if r else "")


def round_it(rnd: str) -> str:
    r = rnd.strip()
    low = r.lower()
    leg = " (andata)" if "1st leg" in low else " (ritorno)" if "2nd leg" in low else ""
    if low.startswith("group") and len(r) <= 8 and low != "group stage":
        return "girone " + r.split()[-1]
    if "group stage" in low or "league phase" in low or "league stage" in low:
        return "fase a gironi"
    if "third place" in low or "3rd" in low:
        return "finale per il terzo posto"
    if "semi" in low:
        return "semifinale" + leg
    if "quarter" in low:
        return "quarti di finale" + leg
    if "last 16" in low or "round of 16" in low or "1/8" in low:
        return "ottavi di finale" + leg
    if "intermediate" in low or "play-off" in low or "playoff" in low or "knockout round play" in low:
        return "spareggi" + leg
    if "final" in low:
        return "finale" + leg
    m = re.match(r"(\d+)\. matchday", low)
    if m:
        return f"{m.group(1)}ª giornata"
    return ""


def ranking(rows: list[tuple[str, str, float, str | None]], *, reverse: bool = True, max_ties: int = 4, min_len: int = 12):
    """rows: (id, name, value, label). Returns the top 10 with ties at the 10th place sharing rank 10, or None."""
    rows = sorted(rows, key=lambda x: ((-x[2]) if reverse else x[2], x[1]))
    if len(rows) < min_len:
        return None
    tenth = rows[9][2]
    out = []
    for pid, name, v, lab in rows:
        better = sum(1 for r in rows if (r[2] > v if reverse else r[2] < v))
        rank = better + 1
        if rank > 10:
            break
        e = {"rank": 10 if v == tenth else rank, "id": pid, "name": name, "value": v}
        if lab:
            e["label"] = lab
        out.append(e)
    if len([r for r in out if r["rank"] == 10]) > max_ties:
        return None
    return out

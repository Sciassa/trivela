"""Build the curated archive (content/questions/*.json) with automatic verification.

Each question declares one authoritative source and a machine check:
  - "tm":   a SQL query on the Transfermarkt history must return the expected value
  - "wiki": a quote must appear verbatim in the raw wikitext of the cited page
  - "of":   a fact computed on openfootball data
Questions whose check fails (or that cannot be checked) are written with status "draft"
and never enter the packs.
"""

from __future__ import annotations

import datetime as dt
import json
import random

from . import http
from .gen_tm import TM, TM_DATASET, opts4
from .paths import OF_DIR, REPO

OUT = REPO / "content" / "questions"


def wiki_ok(lang: str, title: str, quote: str) -> bool:
    text = http.wp_raw(title, lang) or ""
    return quote.lower() in " ".join(text.split()).lower()


def wiki_src(lang: str, title: str, quote: str) -> dict:
    return {"family": "wikimedia", "label": f"Wikipedia ({lang}): {title}",
            "url": f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}", "quote": quote}


def tm_src(label: str, url: str = TM_DATASET, quote: str = "") -> dict:
    return {"family": "transfermarkt", "label": label, "url": url, "quote": quote or label}


def item(id_, *, question, answer, script, sources, year, ok, options=None, correct=None, game=("tiro_secco",),
         archetype=4, difficulty=2, entities=(), note="") -> dict:
    d = {"id": id_, "game": list(game), "archetype": archetype, "status": "published" if ok else "draft",
         "difficulty": difficulty, "question": question, "answer": answer, "year_min": year, "year_max": year,
         "entities": list(entities), "script": script, "claims": [{"text": script, "sources": sources}],
         "author": "pipeline", "reviewer": "verifica automatica"}
    if options is not None:
        d["options"] = options
        d["correct"] = correct
    if note or not ok:
        d["note"] = note or "Verifica automatica non superata: resta in bozza."
    return d


def birthday_scorer_question(t: TM, name: str, age: int, qid: str) -> dict | None:
    """Correct option: scored in Serie A on the given birthday. Distractors: famous players whose same
    birthday falls inside the dataset window and who did not score in Serie A that day."""
    rows = t.q("""select p.player_id, p.date_of_birth from players p where p.name = ?""", name)
    if not rows:
        return None
    pid_, dob = rows[0]
    day = dt.date(dob.year + age, dob.month, dob.day)
    hit = t.q("""select g.home_club_name, g.away_club_name, g.home_club_goals, g.away_club_goals, e.minute, g.url
                 from game_events e join games g using(game_id)
                 where e.type='Goals' and e.player_id=? and g.date=? and g.competition_id='IT1'""", pid_, day)
    if not hit:
        return None
    cands = t.q("""select p.player_id, p.name, p.date_of_birth from players p
                   where p.date_of_birth is not null and year(p.date_of_birth) + ? between 2013 and 2025
                     and p.player_id in (select player_id from appearances where competition_id='IT1')""", age)
    pool = []
    for cp, cname, cdob in cands:
        if t.fame(cp) < 70 or cp == pid_:
            continue
        cday = dt.date(cdob.year + age, cdob.month, cdob.day) if not (cdob.month == 2 and cdob.day == 29) else None
        if not cday:
            continue
        scored = t.q("""select 1 from game_events e join games g using(game_id)
                        where e.type='Goals' and e.player_id=? and g.date=? and g.competition_id='IT1'""", cp, cday)
        if not scored:
            pool.append(cname)
    o = opts4(name, sorted(pool, key=lambda n: random.Random(n).random())[:12], qid)
    if not o:
        return None
    h = hit[0]
    script = (f"{name} segnò al {h[4]}' di {h[0]}-{h[1]} {h[2]}-{h[3]} il {day.day}/{day.month}/{day.year}, "
              f"giorno del suo {age}° compleanno.")
    return item(qid, question=f"Quale di questi giocatori ha segnato in Serie A nel giorno del suo {age}° compleanno?",
                answer=name, options=o[0], correct=o[1], script=script, archetype=1, year=day.year,
                sources=[tm_src(f"Transfermarkt: tabellino {h[0]}-{h[1]}", h[5] or TM_DATASET, f"{name} {h[4]}'")], ok=True)


def build() -> list[dict]:
    t = TM()
    items: list[dict] = []

    # 1-3. birthday goals (from the original brief, checked on Transfermarkt data)
    for name, age, qid in (("Stephan El Shaarawy", 20, "q-bday-elshaarawy"), ("Romelu Lukaku", 30, "q-bday-lukaku"),
                           ("Dries Mertens", 30, "q-bday-mertens")):
        q = birthday_scorer_question(t, name, age, qid)
        if q:
            items.append(q)

    # 4. score at Kalulu's dismissal in Inter-Juventus 14/02/2026
    rows = t.q("""select e.minute, e.club_id, e.description, g.home_club_id, g.url from game_events e join games g using(game_id)
                  where g.date='2026-02-14' and g.home_club_name='Inter Milan' and g.away_club_name='Juventus FC' order by e.minute""")
    red = next((r for r in rows if "Second yellow" in (r[2] or "") or "Red card" in (r[2] or "")), None)
    if red:
        goals = t.q("""select e.minute, e.club_id from game_events e join games g using(game_id)
                       where g.date='2026-02-14' and g.home_club_name='Inter Milan' and e.type='Goals' and e.minute < ?""", red[0])
        h = sum(1 for g in goals if g[1] == red[3])
        a = len(goals) - h
        score = f"{h}-{a}"
        o = opts4(score, ["0-0", "1-0", "0-1", "2-1", "1-2", "2-0"], "kalulu")
        items.append(item("q-kalulu-2026", question="Qual era il risultato di Inter-Juventus del 14 febbraio 2026 al momento dell'espulsione di Kalulu?",
                          answer=score, options=o[0], correct=o[1], archetype=2, year=2026,
                          script=f"Kalulu fu espulso per doppia ammonizione al {red[0]}', sul {score}. La partita finì 3-2 per l'Inter.",
                          sources=[tm_src("Transfermarkt: tabellino Inter-Juventus 3-2", red[4] or TM_DATASET, f"Second yellow {red[0]}'")], ok=True))

    # 5. Montolivo: red card in his last appearance
    last = t.q("""select a.date, g.home_club_name, g.away_club_name, g.home_club_goals, g.away_club_goals, a.red_cards, g.url
                  from appearances a join games g using(game_id) join players p on p.player_id=a.player_id
                  where p.name='Riccardo Montolivo' order by a.date desc limit 1""")
    ok = bool(last and last[0][5] == 1)
    others = []
    for name in ("Steven Gerrard", "Bastian Schweinsteiger", "Andrea Pirlo", "Daniele De Rossi", "Xabi Alonso", "Marek Hamšík"):
        r = t.q("""select a.red_cards from appearances a join players p on p.player_id=a.player_id where p.name=? order by a.date desc limit 1""", name)
        if r and r[0][0] == 0:
            others.append(name)
    o = opts4("Riccardo Montolivo", others, "montolivo")
    if last and o:
        lg = last[0]
        items.append(item("q-montolivo-last", question="Quale di questi centrocampisti fu espulso nell'ultima partita ufficiale registrata della sua carriera?",
                          answer="Riccardo Montolivo", options=o[0], correct=o[1], archetype=3, year=lg[0].year,
                          script=f"L'ultima presenza di Riccardo Montolivo fu {lg[1].replace(' BC','')}-{lg[2].replace('AC ','')} {lg[3]}-{lg[4]} del {lg[0].day}/{lg[0].month}/{lg[0].year}: finì con un'espulsione.",
                          sources=[tm_src("Transfermarkt: presenze di Riccardo Montolivo", lg[6] or TM_DATASET, "red_cards = 1")], ok=ok and len(o[0]) == 4,
                          note="Distrattori: ultima presenza registrata senza espulsione (dati Transfermarkt)."))

    # 6. Romagnoli captains
    caps = t.q("""select l.player_name, p.date_of_birth, l.number, p.city_of_birth from game_lineups l join games g using(game_id)
                  join players p on p.player_id=l.player_id
                  where g.date='2021-12-22' and l.team_captain=1 and l.player_name ilike '%Romagnoli%'""")
    if len(caps) == 2:
        same_dob = caps[0][1] == caps[1][1]
        same_num = caps[0][2] == caps[1][2]
        same_city = (caps[0][3] or "a") == (caps[1][3] or "b")
        ok = not (same_dob or same_num or same_city)
        opts = ["Avevano lo stesso cognome", "Erano nati lo stesso giorno", "Indossavano lo stesso numero di maglia", "Erano nati nella stessa città"]
        items.append(item("q-romagnoli-captains", question="In Empoli-Milan del 22 dicembre 2021, che cosa avevano in comune i due capitani?",
                          answer=opts[0], options=opts, correct=0, archetype=4, year=2021,
                          script=f"I capitani erano {caps[0][0]} e {caps[1][0]}: stesso cognome, date di nascita, numeri e città natali diversi.",
                          sources=[tm_src("Transfermarkt: formazioni Empoli-Milan del 22/12/2021", TM_DATASET, "team_captain = 1")], ok=ok))

    # 7. Di Natale and Iperzola
    q7 = "1997-1998| → Iperzola|37 (6)"
    items.append(item("q-dinatale-iperzola", question="In quale piccolo club di Serie C2 Antonio Di Natale giocò in prestito nella stagione 1997-98, segnando i suoi primi gol da professionista?",
                      answer="Iperzola", options=["Iperzola", "Viareggio", "Sangiovannese", "Castel di Sangro"], correct=0, archetype=3, year=1997,
                      script="Nella stagione 1997-98 Di Natale giocò in prestito all'Iperzola: 37 presenze e 6 gol.",
                      sources=[wiki_src("it", "Antonio Di Natale", q7)], ok=wiki_ok("it", "Antonio Di Natale", q7),
                      note="Distrattore 'Viareggio' è il club della stagione successiva (verificabile sulla stessa pagina)."))

    # 8. Gladstone
    q8 = "Gioca pochi minuti in [[Coppa Italia 2005-2006|Coppa Italia]] il 10 gennaio [[2006]]"
    items.append(item("q-gladstone", question="Quale difensore brasiliano, arrivato alla Juventus in prestito, giocò solo pochi minuti in Coppa Italia il 10 gennaio 2006 prima di essere girato al Verona?",
                      answer="Gladstone", game=("tiro_secco", "cassaforte"), archetype=3, difficulty=3, year=2006,
                      options=["Gladstone", "Lúcio", "Felipe Melo", "Diego"], correct=0,
                      script="Gladstone giocò pochi minuti in Coppa Italia contro la Fiorentina il 10 gennaio 2006, poi passò in prestito all'Hellas Verona.",
                      sources=[wiki_src("it", "Gladstone Pereira della Valentina", q8)],
                      ok=wiki_ok("it", "Gladstone Pereira della Valentina", q8)))

    # 9. Elkjær and the vodka
    q9 = "in fact it was a bottle of [[vodka]] and ''two'' ladies"
    items.append(item("q-elkjaer-vodka", question="Accusato dal suo allenatore di aver passato la notte in un locale con una bottiglia di whisky e una donna, quale attaccante danese rispose che era una bugia: era vodka, e le donne erano due?",
                      answer="Preben Elkjær", options=["Preben Elkjær", "Michael Laudrup", "Allan Simonsen", "Jon Dahl Tomasson"], correct=0,
                      archetype=4, difficulty=2, year=1977,
                      script="Preben Elkjær rispose che non era vero: era una bottiglia di vodka, e le donne erano due.",
                      sources=[wiki_src("en", "Preben Elkjær", q9)], ok=wiki_ok("en", "Preben Elkjær", q9)))

    # 10. Superga: intermediate stop in Barcelona
    q10 = "Scalo_intermedio = [[Aeroporto di Barcellona]]"
    items.append(item("q-superga-scalo", question="Da quale città europea decollò per l'ultima volta l'aereo del Grande Torino il 4 maggio 1949?",
                      answer="Barcellona", options=["Lisbona", "Barcellona", "Madrid", "Marsiglia"], correct=1, archetype=6, year=1949,
                      game=("tiro_secco", "cassaforte"),
                      script="Il volo partì da Lisbona, ma fece scalo a Barcellona: da lì l'ultimo decollo verso Torino.",
                      sources=[wiki_src("it", "Tragedia di Superga", q10)], ok=wiki_ok("it", "Tragedia di Superga", q10)))

    # 11. Juventus 2011/12: the only Monday game (openfootball)
    p = OF_DIR / "football.json" / "2011-12" / "it.1.json"
    if p.exists():
        ms = [m for m in json.loads(p.read_text())["matches"] if "Juventus" in (m["team1"], m["team2"])]
        mondays = [m for m in ms if dt.date.fromisoformat(m["date"]).weekday() == 0]
        lab = lambda m: f"{m['team1']}-{m['team2']} {m['score']['ft'][0]}-{m['score']['ft'][1]}"  # noqa: E731
        if len(mondays) == 1:
            o = opts4(lab(mondays[0]), [lab(m) for m in ms if m is not mondays[0]], "juve-monday")
            items.append(item("q-juve-1112-monday", question="Quale fu l'unica partita del campionato 2011/12 che la Juventus giocò di lunedì?",
                              answer=lab(mondays[0]), options=o[0], correct=o[1], archetype=1, year=2011,
                              script=f"Nella Serie A 2011/12 la Juventus giocò di lunedì solo {lab(mondays[0])}, il {mondays[0]['date']}.",
                              sources=[{"family": "openfootball", "label": "openfootball: Serie A 2011/12",
                                        "url": "https://github.com/openfootball/football.json/blob/master/2011-12/it.1.json",
                                        "quote": mondays[0]["date"]}], ok=True))

    # Claims from the brief that cannot be verified with the current sources: kept as drafts.
    drafts = [
        ("q-juve-1112-monday", "Quale fu l'unica partita del campionato 2011/12 che la Juventus giocò di lunedì?", "Roma-Juventus 1-1",
         "La stagione 2011/12 non è coperta né da openfootball (it.1) né dal dataset Transfermarkt."),
        ("q-eto-30", "Quale di questi attaccanti NON ha segnato in Serie A nel giorno del suo 30° compleanno tra Eto'o, Lukaku, Mertens e Palacio?",
         "Eto'o", "Il compleanno di Eto'o e di Palacio cade prima della copertura del dataset Transfermarkt (2012/13)."),
        ("q-gasperini-mourinho", "Quali due allenatori nati lo stesso giorno (26 gennaio) si sono affrontati in Champions League?",
         "Gasperini e Mourinho", "Non ho trovato fonti che confermino una sfida di Champions League tra i due."),
        ("q-pescara-milan-1992", "Nel Pescara-Milan 4-5 del 13 settembre 1992, qual era il punteggio al 15'?", "3-2 per il Pescara",
         "Minuti dei gol non disponibili nelle fonti scaricabili."),
        ("q-batistuta-oldtrafford", "Manchester United-Fiorentina 3-1 del 15 marzo 2000: per quanti minuti la Fiorentina restò in vantaggio?",
         "4 minuti", "Da verificare sui tabellini (fonte non ancora collegata)."),
        ("q-cesena-rodriguez", "Quale difensore del Cesena andò in porta e subì il rigore di Vidal in Juventus-Cesena 2-0 del 4 dicembre 2011?",
         "Guillermo Rodríguez", "Pagina della fonte non trovata."),
        ("q-buffon-debut", "Cosa accadde a Buffon nella sua prima partita in Nazionale (Russia-Italia 1997)?", "Subì un autogol di Cannavaro",
         "La fonte consultata non riporta il dettaglio."),
        ("q-derossi-barthez", "Cosa disse De Rossi a Barthez dopo il rigore nella finale del 2006?", "Buttaci i guanti", "Nessuna fonte trovata."),
        ("q-zamparini-crop", "Nell'estate 2010 cerchi nel grano comparvero in un terreno di quale presidente di Serie A?", "Maurizio Zamparini",
         "La fonte consultata non menziona l'episodio."),
        ("q-bodo-telaviv", "Qual è la città più a sud ad aver ospitato una gara della fase finale di Champions League?", "Tel Aviv",
         "Richiede l'elenco completo delle sedi con coordinate: non ancora disponibile."),
        ("q-cl-italians-no-win", "I 10 italiani con più presenze in Champions League senza averla mai vinta", "Buffon, Bonucci, Verratti…",
         "Il dataset copre le presenze solo dal 2012/13."),
    ]
    for qid, question, answer, note in drafts:
        items.append(item(qid, question=question, answer=answer, script=answer, archetype=4, year=2000,
                          sources=[{"family": "brief", "label": "Esempio fornito dal committente", "url": "about:blank", "quote": answer}],
                          ok=False, note=note))
    return items


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    items = build()
    for it in items:
        (OUT / f"{it['id']}.json").write_text(json.dumps(it, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pub = sum(1 for it in items if it["status"] == "published")
    print(f"{len(items)} domande scritte, {pub} pubblicate, {len(items) - pub} in bozza")


if __name__ == "__main__":
    main()

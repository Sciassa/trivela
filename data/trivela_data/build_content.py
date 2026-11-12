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
    """Curated questions. The archive was emptied on request: every question here must be NEW
    (not taken from the TV episodes used as inspiration) and pass the automatic check."""
    return []


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    items = build()
    for it in items:
        (OUT / f"{it['id']}.json").write_text(json.dumps(it, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pub = sum(1 for it in items if it["status"] == "published")
    print(f"{len(items)} domande scritte, {pub} pubblicate, {len(items) - pub} in bozza")


if __name__ == "__main__":
    main()

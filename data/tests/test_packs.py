"""Invariants of the generated packs (apps/web/public/data). Run after `python -m trivela_data.generate`."""

import json
import re
from collections import Counter
from pathlib import Path

import pytest
from PIL import Image

from trivela_data.postprocess import is_show_case
from trivela_data.tm_core import articled, clean_club, fee_label, season_label

DATA = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "data"
GAMES = ["tiro_secco", "mercato", "decina", "dischetto", "formazione", "giramondo", "asta", "maglia", "testa_a_testa", "bandiere"]
# visual games (SPEC §0.8): as many questions as the licensed assets allow, with a floor of their own
VISUAL = {"stemma": 150, "figurina": 300}
PUBLIC = DATA.parent
FREE = {"cc0", "pd", "cc-by", "cc-by-sa"}
pytestmark = pytest.mark.skipif(not (DATA / "manifest.json").exists(), reason="packs not generated")


def load(game):
    return json.loads((DATA / "games" / f"{game}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("game", GAMES)
def test_at_least_1000_new_questions_with_sources(game):
    items = load(game)
    assert len(items) >= 1000
    assert len({it["id"] for it in items}) == len(items)
    assert all(it["sources"] and it["script"] for it in items)
    assert not any(is_show_case(it) for it in items)


def test_tiro_secco_has_four_distinct_options_and_variety():
    items = load("tiro_secco")
    for it in items:
        n = 2 if it.get("tag") == "vf" else 4
        assert len(it["options"]) == n and len(set(it["options"])) == n and 0 <= it["correct"] < n
    assert len({it["generator"].split("@")[0] for it in items}) >= 15


def test_giramondo_is_chronological_and_has_no_repeated_club():
    for it in load("giramondo"):
        entries = [e for c in it["clues"] for e in c.split("; ") if re.match(r"\d{4} ", e)]
        years = [int(e[:4]) for e in entries]
        clubs = [e[5:] for e in entries]
        assert years == sorted(years), it["answer"]["display"]
        assert len(set(clubs)) == len(clubs), it["answer"]["display"]  # first arrival only: no back-and-forth
        assert len(it["clues"]) == 5


def test_league_tags():
    """Every item names the competition it belongs to, so the league filter can work."""
    tagged = {g: sum(1 for it in load(g) if any(e.startswith("comp:") for e in it["entities"])) for g in GAMES}
    assert all(n == len(load(g)) for g, n in tagged.items() if g != "giramondo"), tagged
    assert tagged["giramondo"] > 900  # careers through at least one top-five league
    leagues = {"IT1", "GB1", "ES1", "L1", "FR1"}
    for lg in leagues:
        enough = [g for g in GAMES if sum(1 for it in load(g) if f"comp:{lg}" in it["entities"]) >= 40 or g in ("giramondo",)]
        assert len(enough) >= 5, (lg, enough)


RARE_ANOMALIES = {"an_portiere_gol", "an_difensore_tripletta", "an_difensore_doppietta", "an_panchina_tripletta", "an_poker", "an_autogol_e_gol",
                  "an_subentrato_espulso_5", "an_subentrato_espulso_10", "an_espulso_presto_5", "an_espulso_presto_10", "an_tre_espulsi",
                  "an_andata_ritorno", "an_portiere_assist", "an_gol_lampo_2"}


def test_wrong_options_are_not_spotted_by_fame():
    """SPEC §4.1, v10: the right answer used to be the one unknown name among three stars (half of the records). The
    wrong options are now as famous as the answer and the answer is the least famous, the most famous or one in between
    about equally often."""
    fame = {e["name"]: e["fame"] for e in json.loads((DATA / "entities.json").read_text(encoding="utf-8"))}
    for tag in ("record", None):
        rank, n = Counter(), 0
        for it in load("tiro_secco"):
            if it.get("tag") != tag:
                continue
            f = [fame.get(o) for o in it["options"]]
            if None in f:
                continue
            n += 1
            rank[sum(1 for v in f if v < f[it["correct"]])] += 1
        assert n >= 300, (tag, n)
        assert all(0.1 <= rank[k] / n <= 0.4 for k in range(4)), (tag, {k: round(v / n, 2) for k, v in rank.items()})


def test_one_question_per_rare_fact():
    """The same record with three other names was the same question: once seen, never hard again."""
    items = [it for it in load("tiro_secco") if it.get("tag") == "record"]
    facts = Counter((it["generator"], next(e for e in it["entities"] if e.startswith("comp:")), it["options"][it["correct"]]) for it in items)
    assert max(facts.values()) == 1, facts.most_common(3)


def test_rare_records_are_part_of_tiro_secco_and_only_genuinely_rare():
    """The old Anomalia game is one family of Tiro Secco questions. Everyday events (a substitute scoring, a forward without a goal) are not records."""
    assert not (DATA / "games" / "anomalia.json").exists()
    items = [it for it in load("tiro_secco") if it.get("tag") == "record"]
    assert len(items) >= 400
    gens = {it["generator"].split("@")[0] for it in items}
    assert gens <= RARE_ANOMALIES, gens - RARE_ANOMALIES
    assert all(it["generator"].startswith("an_") for it in items)
    # the headline records the game promises are all there
    for must in ("an_portiere_gol", "an_autogol_e_gol", "an_subentrato_espulso_5", "an_difensore_tripletta", "an_tre_espulsi", "an_andata_ritorno"):
        assert must in gens, must
    for it in items:
        g = it["generator"].split("@")[0]
        if g == "an_subentrato_espulso_5":
            assert int(re.search(r"\((\d+) minuti dopo\)", it["script"]).group(1)) < 5, it["script"]
        if g == "an_subentrato_espulso_10":
            assert 5 <= int(re.search(r"\((\d+) minuti dopo\)", it["script"]).group(1)) < 10, it["script"]
        if g == "an_espulso_presto_5":
            assert int(re.search(r"espulso al (\d+)'", it["script"]).group(1)) <= 5, it["script"]
        if g == "an_espulso_presto_10":
            assert 5 < int(re.search(r"espulso al (\d+)'", it["script"]).group(1)) <= 10, it["script"]
        if g == "an_tre_espulsi":
            assert int(re.search(r"con (\d+) giocatori espulsi", it["script"]).group(1)) >= 3, it["script"]
        if g == "an_gol_lampo_2":
            m = re.search(r"entrato al (\d+)', gol al (\d+)'", it["script"])
            assert m and 0 <= int(m.group(2)) - int(m.group(1)) <= 2, it["script"]
        if g == "an_autogol_e_gol":
            assert "autogol" in it["script"] and "gol per la propria squadra" in it["script"]


def test_name_games_offer_four_surnames_of_one_family():
    """«Quale di questi cognomi (tutti nomi di animali) appartiene a un giocatore che ha giocato in Serie A?» Gatti · Cani · Topi · Salmoni.
    The right one is the surname of the player named in the script; the wrong ones are surnames of no player there."""
    from trivela_data import lexicon

    items = [it for it in load("tiro_secco") if it.get("tag") == "nomi"]
    # v10: only wrong surnames that belong to a known footballer, as famous as the right one: fewer questions, none
    # answered by "it is the only surname I have heard of"
    assert len(items) >= 50
    gens = {it["generator"].split("@")[0] for it in items}
    cats = {g[5:] for g in gens if g[5:] in {*lexicon.CATEGORIES, "dittatori"}}
    assert len(cats) >= 3, cats
    assert "nomi_gol" in gens  # crossed with goals
    comp = lambda it: next(e for e in it["entities"] if e.startswith("comp:"))
    asked = Counter((it["options"][it["correct"]], it["generator"].split("@")[0], comp(it)) for it in items)
    assert max(asked.values()) == 1, asked.most_common(3)  # one question per surname and competition
    for it in items:
        assert it["question"].startswith("Quale di questi cognomi (")
        assert all(" " not in o for o in it["options"]) and len(set(it["options"])) == 4
        right = it["options"][it["correct"]]
        assert re.search(rf"\b{re.escape(right)}\b", it["script"]), it["script"]
        assert sum(1 for e in it["entities"] if e.startswith("tm:p:")) == 1  # one real player: the owner of the right surname
        assert "«" in it["script"]  # the script says what the word means
    played = [it for it in items if it["generator"].split("@")[0] != "nomi_gol"]
    assert all("ha giocato" in it["question"] and "sono cognomi di calciatori veri (" in it["script"] for it in played)  # with their bearers
    # credible wrong options: words of the same family, never made-up plurals like «Salmoni» or «Topi»
    family = {f"nomi_{c}": {lexicon_word for lexicon_word in words} for c, words in lexicon.CATEGORIES.items()}
    family["nomi_dittatori"] = set(lexicon.CATEGORIES["storia"])
    for it in played:
        g = it["generator"].split("@")[0]
        lower = {o.lower() for o in it["options"]}
        assert lower <= family[g], (it["options"], g)
    assert not any(o in {"Salmoni", "Topi", "Cani", "Maiali"} for it in items for o in it["options"])
    goals = [it for it in items if it["generator"].split("@")[0] == "nomi_gol"]
    assert all(re.search(r"almeno \d+ gol", it["question"]) for it in goals)


def test_lexicon_words_are_lower_case_and_unambiguous():
    from trivela_data import lexicon

    for cat, words in lexicon.CATEGORIES.items():
        for w, (meaning, note) in words.items():
            assert w == w.strip().lower() and meaning and note, (cat, w)
    assert all(c in {*lexicon.CATEGORIES, "dittatori"} for cs in lexicon.ALSO.values() for c in cs)


def test_formazione_only_iconic_matches():
    """Cups from the quarter-finals on; league games only as derbies, first against second, or freak scores."""
    items = load("formazione")
    kinds = {it["generator"] for it in items}
    assert kinds <= {"formazione_coppa", "formazione_derby", "formazione_vetta", "formazione_punteggio"}, kinds
    assert len(kinds) == 4
    for it in items:
        comp = it["competition"]
        if it["generator"] == "formazione_coppa":
            assert re.search(r"quarti|semifinale|finale", comp), comp
            assert not re.search(r"girone|ottavi|giornata|spareggi", comp), comp
        elif it["generator"] == "formazione_punteggio":
            a, b = map(int, re.search(r" (\d+)-(\d+)$", it["title"]).groups())
            assert a + b >= 8 or abs(a - b) >= 6, it["title"]
        else:
            assert "giornata" in comp, comp


def test_dischetto_has_the_new_rankings():
    gens = {it["generator"].split("@")[0] for it in load("dischetto")}
    for g in ("dis_league_reds", "dis_league_subapps", "dis_season_subapps", "dis_league_shirts", "dis_season_old", "dis_tournament_scorers"):
        assert g in gens, g
    shirts = [it for it in load("dischetto") if it["generator"].split("@")[0] == "dis_league_shirts"]
    assert any("Serie A" in it["title"] for it in shirts)
    for it in load("dischetto"):
        assert not any(r["name"].startswith("#") for r in it["ranking"]), it["title"]


def test_mercato_mostly_big_transfers_in_every_league():
    """SPEC §4.3 (v11): transfers of all five leagues, tagged with the leagues of the two clubs at the time; about four in
    five worth 20 million or more (the engine draws the generators 0.78/0.22), the cheaper ones only for known players."""
    items = load("mercato")
    big = [it for it in items if it["generator"] == "mercato"]
    minor = [it for it in items if it["generator"] == "mercato_minore"]
    assert len(big) + len(minor) == len(items) and len(big) >= 900
    millions = lambda it: float(it["clues"][0].split()[0].replace(".", "").replace(",", ".")) if "mln" in it["clues"][0] else 0.0  # noqa: E731
    assert all(millions(it) >= 20 for it in big) and all(millions(it) < 20 for it in minor)
    assert all(it["fame"] >= 80 for it in minor)
    for lg in ("IT1", "GB1", "ES1", "L1", "FR1"):
        assert sum(1 for it in big if f"comp:{lg}" in it["entities"]) >= 150, lg
        assert sum(1 for it in minor if f"comp:{lg}" in it["entities"]) >= 50, lg


def test_testa_a_testa_chains():
    """SPEC §4.11: nine players, one statistic, eight comparisons closer and closer, both ways, never a tie, window declared."""
    from trivela_data.gen_testa import Testa

    items = load("testa_a_testa")
    stats = {it["generator"].split("@")[0] for it in items}
    assert {"testa_gol", "testa_presenze", "testa_altezza", "testa_valore", "testa_cartellino", "testa_eta"} <= stats
    for it in items:
        ch = it["chain"]
        assert len(ch) == 9 and len({c["id"] for c in ch}) == 9
        ups = [b["value"] > a["value"] for a, b in zip(ch, ch[1:])]
        assert any(ups) and not all(ups), it["title"]
        assert not any(ups[k] == ups[k + 1] == ups[k + 2] for k in range(len(ups) - 2)), it["title"]
        kind = {"cm": "cm", "anni": "years"}.get(it["unit"], "rel")
        for step, (a, b) in enumerate(zip(ch, ch[1:])):
            assert a["value"] != b["value"] and Testa.gap_ok(kind, step, a["value"], b["value"]), (it["title"], step, a, b)
        if it["unit"] in ("gol", "presenze"):
            assert re.search(r"\(dal \d{4}/\d{2} al \d{4}/\d{2}\)|\(stagione \d{4}/\d{2}\)", it["title"]), it["title"]
        assert sum(1 for e in it["entities"] if e.startswith("comp:")) == 1


def test_tiro_secco_true_or_false_transfers():
    """SPEC §4.1, v14: real moves and moves proven false, as many of each; no loan/permanent variant (no field for it)."""
    items = [it for it in load("tiro_secco") if it.get("tag") == "vf"]
    assert len(items) >= 1000
    assert sum(1 for it in items if it["correct"] == 0) == sum(1 for it in items if it["correct"] == 1)
    for it in items:
        assert it["options"] == ["VERO", "FALSO"] and it["generator"].split("@")[0] == "ts_vero_falso"
        tr = it["transfer"]
        assert tr["player"] in it["question"] and re.fullmatch(r"\d{4}/\d{2}", tr["season"])
        assert it["script"].startswith("Vero:" if it["correct"] == 0 else "Falso:")
        if it["correct"] == 1:
            assert "non ha mai giocato né firmato" in it["script"]
        assert any(e.startswith("comp:") for e in it["entities"])
        assert "prestito" not in it["question"].lower() and "definitivo" not in it["question"].lower()


def test_tiro_secco_season_families():
    """SPEC §4.1, v15: the questions of the old Le Statistiche and La Stagione dei Campioni now live in the Tiro Secco."""
    items = load("tiro_secco")
    fam = Counter(it.get("tag") for it in items)
    assert fam["scheda"] >= 400 and fam["campioni"] >= 1000 and fam["confronto"] >= 300, fam
    # every family of questions is there, so the four questions of a match can all be of a different kind
    assert {"record", "nomi", "vf", "scheda", "campioni", "confronto", None} <= set(fam)
    cards = Counter()
    for it in (x for x in items if x.get("tag") == "scheda"):
        c = it["card"]
        st = c["stats"]
        assert c["scope"] == f"Solo {c['competition']}" and re.fullmatch(r"\d{4}/\d{2}", c["season"])
        assert st["presenze"] >= 20 and c["role"]
        # a season worth remembering: never «20 games, 0 goals»
        assert st["gol"] >= 5 or st["assist"] >= 10 or st["gol"] + st["assist"] >= 14, st
        assert sum(1 for e in it["entities"] if e.startswith("comp:")) == 1
        cards[(c["competition"], c["season"], tuple(st.values()), c["role"], c["nat"])] += 1
    assert max(cards.values()) == 1
    for it in (x for x in items if x.get("tag") == "confronto"):
        # the four values are named in the Copione, all different, the answer first
        vals = [int(v) for v in re.findall(r" (\d+) (?:gol|assist|gialli)", it["script"])]
        assert len(vals) == 4 and len(set(vals)) == 4 and vals == sorted(vals, reverse=True), it["script"]
        assert it["options"][it["correct"]] in it["script"].split(",")[1]
        assert "in campionato" in it["question"]
    gens = {it["generator"].split("@")[0] for it in items if it.get("tag") in ("campioni", "confronto")}
    assert {"stg_campione", "stg_capocannoniere", "stg_assist", "stg_portiere", "stg_attacco", "stg_difesa", "stg_club_marcatore",
            "stg_club_presenze", "stg_club_assist", "stg_club_posizione", "ts_confronto_gol", "ts_confronto_assist", "ts_confronto_gialli"} <= gens
    # the Ligue 1 2019/20 was stopped: its table is not complete, no champion asked
    assert not any(it["generator"].startswith("stg_campione") and "Ligue 1 2019/20" in it["question"] for it in items)


def test_bandiere_lineups():
    """SPEC §4.14: eleven real starters of one side, each with a nationality and a flag file; the team among four."""
    flags = DATA.parent / "flags"
    items = load("bandiere")
    for it in items:
        assert len(it["players"]) == 11 and len({p["id"] for p in it["players"]}) == 11
        assert all(p["flag"] and p["nat"] and p["name"] and (flags / f"{p['flag']}.svg").exists() for p in it["players"])
        assert sum(1 for p in it["players"] if p["y"] == min(q["y"] for q in it["players"])) == 1  # one goalkeeper at the back
        assert len(set(it["options"])) == 4 and it["options"][it["correct"]] == it["team"]
        assert it["formation"] is None or re.fullmatch(r"\d(-\d)+", it["formation"])


def test_maglia_asks_for_a_number_and_skips_banal_ones():
    items = load("maglia")
    for it in items:
        assert it["answer"]["kind"] == "number" and 1 <= it["answer"]["value"] <= 99
        assert it["player"] in it["question"]
        v, role = it["answer"]["value"], it["role"]
        assert not (v == 1 and role == "GK") and not (v == 9 and role == "ATT"), it["question"]
    kinds = [it["generator"].split("@")[0] for it in items]
    assert kinds.count("maglia_anomala") >= 120 and kinds.count("maglia_pesante") >= 300
    # the same shirt in five seasons is one question, and nobody fills more than two (Viviano came back match after match)
    shirts = [(it["player"], it["team"], it["answer"]["value"]) for it in items]
    assert len(shirts) == len(set(shirts))
    per_player = Counter(next(e for e in it["entities"] if e.startswith("tm:p:")) for it in items)
    assert max(per_player.values()) <= 2, per_player.most_common(3)
    classic = [it for it in items if it["generator"].startswith("maglia_numero") and it["answer"]["value"] < 12]
    assert len(classic) <= 0.08 * len(items)  # plain numbers are the exception


def test_rankings_and_sets():
    for it in load("dischetto"):
        ranks = [r["rank"] for r in it["ranking"]]
        assert ranks == sorted(ranks) and ranks[0] == 1 and len(it["ranking"]) >= 10 and it["hint"]
    assert all(14 <= len(it["members"]) <= 17 for it in load("decina"))
    assert all(8 <= len(it["members"]) <= 30 for it in load("asta"))


def test_formazione_hides_five_per_team():
    for it in load("formazione"):
        for team in it["teams"]:
            assert len(team["players"]) == 11 and sum(p["hidden"] for p in team["players"]) == 5


def test_entities_are_unique_people():
    ents = json.loads((DATA / "entities.json").read_text(encoding="utf-8"))
    assert len({e["id"] for e in ents}) == len(ents)
    manolas = [e for e in ents if "manolas" in e["name"].lower()]
    assert len(manolas) == 1, manolas


def test_helpers():
    assert clean_club("Associazione Sportiva Roma") == "Roma" and clean_club("Inter Milan") == "Inter"
    assert fee_label(20_900_000) == "20,9 mln €" and season_label(2015) == "2015/16"
    assert articled("di", "Inter") == "dell'Inter" and articled("con", "Juventus") == "con la Juventus"
    assert articled("di", "PSG") == "del PSG" and articled("di", "Paesi Bassi", True) == "dei Paesi Bassi"


def test_visual_games_have_their_own_floor_and_no_copies():
    for game, floor in VISUAL.items():
        items = load(game)
        assert len(items) >= floor, (game, len(items))
        assert len({it["id"] for it in items}) == len(items)
        # one question per crest and variant, one profile per player: never the same picture twice to reach a number
        key = (lambda it: (it["original"], it["variant"])) if game == "stemma" else (lambda it: it["card"]["photo"])
        assert len({key(it) for it in items}) == len(items)


def test_assets_are_all_licensed_and_credited():
    """SPEC §0.8: every crest and photo on the site is in the manifest, with its source page and author; a free licence for
    every Commons file, the user's decision for the football-logos club logos."""
    m = json.loads((DATA / "assets-manifest.json").read_text(encoding="utf-8"))
    listed = set()
    logos = json.loads((DATA.parents[3] / "data" / "static" / "logos_map.json").read_text(encoding="utf-8"))
    by_club = {f"tm:c:{r['tm']}": r for r in logos["logos"]}
    assert len(by_club) == len(logos["logos"])  # one logo per club
    for a in m["assets"]:
        assert a["author"] and a["attribution"] and a["licence"]
        for f in a["files"].values():
            assert (PUBLIC / f).exists(), f
            listed.add(f)
        if a["source"].startswith("luukhopman/football-logos"):
            # the user's decision (SPEC §0.8, v16): no licence declared; only club logos, each one in the reviewed table
            assert a["kind"] == "stemma" and a["licence_class"] == "none" and a["subject"] in by_club, a
            assert a["page"].startswith("https://github.com/luukhopman/football-logos/blob/" + logos["commit"])
            assert a["status"].startswith("decisione dell'utente")
            continue
        assert a["licence_class"] in FREE, a
        assert a["page"].startswith("https://commons.wikimedia.org/") and a["wikidata"].startswith("Q")
        assert a["status"].startswith("verificato")
        if a["kind"] == "foto" or len(a["files"]) > 1:
            assert a["modifiable"], a  # a transformed file only from a licence that allows it
    on_disk = {f"{d}/{p.name}" for d in ("crests", "photos") for p in (PUBLIC / d).glob("*")}
    assert on_disk == listed, sorted(on_disk ^ listed)[:5]
    assert m["counts"]["stemmi"] == sum(1 for a in m["assets"] if a["kind"] == "stemma")


def test_stemma_questions():
    """SPEC §4.15: a transformed crest of a licensed file, four clubs, the answer among them, the variants all present."""
    m = json.loads((DATA / "assets-manifest.json").read_text(encoding="utf-8"))
    crest_files = {f for a in m["assets"] if a["kind"] == "stemma" for f in a["files"].values()}
    items = load("stemma")
    for it in items:
        assert it["variant"] in ("notext", "blur", "silhouette", "colors")
        assert len(set(it["options"])) == 4 and it["options"][it["correct"]] == it["team"]
        assert it["original"] in crest_files and it["credit"]
        if it["variant"] == "colors":
            assert it["image"] is None and 2 <= len(it["colors"]) <= 4
            assert all(re.fullmatch(r"#[0-9a-f]{6}", c) for c, _ in it["colors"])
        else:
            assert it["image"] in crest_files and it["image"] != it["original"]
        # the file names never name the club
        assert not any(w.lower() in (it["image"] or "") for w in it["team"].split() if len(w) > 3)
        assert sum(1 for e in it["entities"] if e.startswith("comp:")) == 1
    per = Counter(it["variant"] for it in items)
    assert per["blur"] and per["silhouette"] and per["colors"], per


def test_figurina():
    """SPEC §4.16 and §14.3: a covered card of a notable player with a licensed photo; five clues, five frames from coarse to
    sharp, real numbers only, no rating; the style from objective thresholds; the answer is the player on the card."""
    m = json.loads((DATA / "assets-manifest.json").read_text(encoding="utf-8"))
    photo_files = {a["subject"]: set(a["files"].values()) for a in m["assets"] if a["kind"] == "foto"}
    items = load("figurina")
    labels = ("Ruolo", "Nazionalità", "Stagione", "Squadra in quella stagione", "Anno di nascita")
    for it in items:
        c, pid = it["card"], it["answer"]["ids"][0]
        assert c["id"] == pid and c["name"] == it["answer"]["display"] and it["entities"].count(pid) == 1
        assert set(c) == {"id", "name", "nat", "flag", "club", "role", "season", "competition", "stats", "style", "photo", "credit"}
        assert c["stats"]["presenze"] >= 10 and c["style"] in ("classica", "speciale", "leggendaria")
        assert re.fullmatch(r"\d{4}/\d{2}", c["season"]) and c["credit"]
        assert [x.split(": ")[0] for x in it["clues"]] == list(labels)
        # every picture is a licensed photo of this very player (matched by Transfermarkt id), never named after him
        assert len(it["frames"]) == 5 and set(it["frames"]) | {c["photo"]} <= photo_files[pid]
        surname = it["answer"]["display"].split()[-1].lower()
        assert len(surname) < 5 or not any(surname in f for f in it["frames"] + [c["photo"]])
        assert it["flag"] == c["flag"] and (c["flag"] is None or (PUBLIC / "flags" / f"{c['flag']}.svg").exists())
        assert sum(1 for e in it["entities"] if e.startswith("comp:")) == 1 and it["activeYears"]
    sizes = [Image.open(PUBLIC / f).size for f in items[0]["frames"]]
    assert sizes == sorted(sizes) and sizes[0][0] <= 4 and sizes[-1][0] < 60  # never the sharp portrait before the reveal
    styles = Counter(it["card"]["style"] for it in items)
    assert styles["classica"] > 0 and styles["speciale"] > 0 and styles["leggendaria"] > 0, styles

"""Invariants of the generated packs (apps/web/public/data). Run after `python -m trivela_data.generate`."""

import json
import re
from pathlib import Path

import pytest

from trivela_data.postprocess import is_show_case
from trivela_data.tm_core import articled, clean_club, fee_label, season_label

DATA = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "data"
GAMES = ["tiro_secco", "mercato", "decina", "dischetto", "formazione", "giramondo", "asta", "maglia"]
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
        assert len(set(it["options"])) == 4 and 0 <= it["correct"] < 4
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
                  "an_andata_ritorno", "an_portiere_assist"}


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
        if g == "an_autogol_e_gol":
            assert "autogol" in it["script"] and "gol per la propria squadra" in it["script"]


def test_name_games_offer_four_surnames_of_one_family():
    """«Quale di questi cognomi (tutti nomi di animali) appartiene a un giocatore che ha giocato in Serie A?» Gatti · Cani · Topi · Salmoni.
    The right one is the surname of the player named in the script; the wrong ones are surnames of no player there."""
    from trivela_data import lexicon

    items = [it for it in load("tiro_secco") if it.get("tag") == "nomi"]
    assert len(items) >= 300
    gens = {it["generator"].split("@")[0] for it in items}
    cats = {g[5:] for g in gens if g[5:] in {*lexicon.CATEGORIES, "dittatori"}}
    assert len(cats) >= 6, cats
    assert {"animali", "dittatori", "citta", "colori", "mestieri"} <= cats
    assert "nomi_gol" in gens  # crossed with goals
    for it in items:
        assert it["question"].startswith("Quale di questi cognomi (")
        assert all(" " not in o for o in it["options"]) and len(set(it["options"])) == 4
        right = it["options"][it["correct"]]
        assert re.search(rf"\b{re.escape(right)}\b", it["script"]), it["script"]
        assert sum(1 for e in it["entities"] if e.startswith("tm:p:")) == 1  # one real player: the owner of the right surname
        assert "«" in it["script"]  # the script says what the word means
    played = [it for it in items if it["generator"].split("@")[0] != "nomi_gol"]
    assert all("ha giocato" in it["question"] and "Nessun giocatore di cognome" in it["script"] for it in played)
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


def test_maglia_asks_for_a_number_and_skips_banal_ones():
    items = load("maglia")
    for it in items:
        assert it["answer"]["kind"] == "number" and 1 <= it["answer"]["value"] <= 99
        assert it["player"] in it["question"]
        v, role = it["answer"]["value"], it["role"]
        assert not (v == 1 and role == "GK") and not (v == 9 and role == "ATT"), it["question"]
    kinds = [it["generator"].split("@")[0] for it in items]
    assert kinds.count("maglia_anomala") >= 150 and kinds.count("maglia_pesante") >= 300
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

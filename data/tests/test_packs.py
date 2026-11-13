"""Invariants of the generated packs (apps/web/public/data). Run after `python -m trivela_data.generate`."""

import json
import re
from pathlib import Path

import pytest

from trivela_data.postprocess import is_show_case
from trivela_data.tm_core import articled, clean_club, fee_label, season_label

DATA = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "data"
GAMES = ["tiro_secco", "anomalia", "mercato", "decina", "dischetto", "formazione", "giramondo", "asta", "maglia"]
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


def test_anomalia_has_four_famous_options_and_variety():
    items = load("anomalia")
    for it in items:
        assert len(set(it["options"])) == 4 and 0 <= it["correct"] < 4 and it["kind"]
        # the perimeter is stated in the question, or (for "which game") in every option
        assert re.search(r"\d{4}/\d{2}|\d{4}", it["question"]) or "stagioni" in it["question"] or all(re.search(r"\d{4}/\d{2}", o) for o in it["options"])
    assert len({it["generator"].split("@")[0] for it in items}) >= 8
    assert any("tripletta" in it["question"] and "difensori" in it["question"] for it in items)  # the flagship anomaly
    assert any("portieri" in it["question"] and "assist" in it["question"] for it in items)
    assert any("panchina" in it["question"] for it in items)


RARE_ANOMALIES = {"an_portiere_gol", "an_difensore_tripletta", "an_difensore_doppietta", "an_panchina_tripletta", "an_poker", "an_autogol_e_gol",
                  "an_subentrato_espulso_5", "an_subentrato_espulso_10", "an_espulso_presto_5", "an_espulso_presto_10", "an_tre_espulsi",
                  "an_andata_ritorno", "an_portiere_assist"}


def test_anomalia_only_genuinely_rare_records():
    """Everyday events (a substitute scoring, a forward without a goal, 100 games without a red card) are not anomalies."""
    items = load("anomalia")
    gens = {it["generator"].split("@")[0] for it in items}
    assert gens <= RARE_ANOMALIES, gens - RARE_ANOMALIES
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

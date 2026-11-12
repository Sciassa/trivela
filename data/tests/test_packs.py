"""Invariants of the generated packs (apps/web/public/data). Run after `python -m trivela_data.generate`."""

import json
import re
from pathlib import Path

import pytest

from trivela_data.postprocess import is_show_case
from trivela_data.tm_core import articled, clean_club, fee_label, season_label

DATA = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "data"
GAMES = ["tiro_secco", "prima_pagina", "mercato", "decina", "dischetto", "formazione", "giramondo", "frame", "asta", "maglia"]
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


def test_giramondo_is_chronological():
    for it in load("giramondo"):
        years = [int(y) for c in it["clues"] for y in re.findall(r"(?:^| → )(\\d{4}) ", c)]
        assert years == sorted(years), it["answer"]["display"]
        assert len(it["clues"]) == 5


def test_maglia_asks_for_a_number():
    for it in load("maglia"):
        assert it["answer"]["kind"] == "number" and 1 <= it["answer"]["value"] <= 99
        assert it["player"] in it["question"]


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

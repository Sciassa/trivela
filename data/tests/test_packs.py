"""Invariants of the generated packs (apps/web/public/data). Run after `python -m trivela_data.generate`."""

import json
import re
from pathlib import Path

import pytest

from trivela_data.postprocess import is_show_case
from trivela_data.tm_core import articled, clean_club, fee_label, season_label

DATA = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "data"
GAMES = ["tiro_secco", "anomalia", "mercato", "decina", "dischetto", "formazione", "giramondo", "frame", "asta", "maglia"]
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
        assert re.search(r"\d{4}/\d{2}|\d{4}", it["question"]) or "stagioni" in it["question"]
    assert len({it["generator"].split("@")[0] for it in items}) >= 8
    assert any("tripletta" in it["question"] and "difensori" in it["question"] for it in items)  # the flagship anomaly
    assert any("portieri" in it["question"] and "assist" in it["question"] for it in items)
    assert any("panchina" in it["question"] for it in items)


def test_frame_timelines_are_anonymous_and_unambiguous():
    items = load("frame")
    assert {it["mode"] for it in items} == {"match", "score"}
    for it in items:
        mins = [e["minute"] for e in it["events"]]
        assert mins == sorted(mins) and any(e["kind"] == "goal" for e in it["events"])
        assert len(set(it["options"])) == 4 and 0 <= it["correct"] < 4
        if it["mode"] == "match":
            goals = [e for e in it["events"] if e["kind"] == "goal"]
            assert all("score" in e for e in goals)
            assert goals[-1]["score"][0] + goals[-1]["score"][1] == len(goals)
            assert "side" in next(e for e in it["events"] if e["kind"] != "goal") or all(e["kind"] == "goal" for e in it["events"])
            assert it["options"][it["correct"]].split(" · ")[0] in it["script"]
        else:
            # goals and cards are bare minutes: nothing but the number of goals can be read off
            assert all(set(e) == {"minute", "kind"} for e in it["events"])
            n = sum(1 for e in it["events"] if e["kind"] == "goal")
            assert n >= 3 and all(sum(map(int, o.split("-"))) == n for o in it["options"])


def test_frame_correct_option_is_the_match_in_the_script():
    """The right option must be the match the facts describe, and no other option may fit them."""
    for it in load("frame"):
        label = re.match(r"(.+?) (\d+)-(\d+) \(", it["script"])
        assert label, it["script"]
        teams, h, a = label.group(1), int(label.group(2)), int(label.group(3))
        right = it["options"][it["correct"]]
        wrong = [o for k, o in enumerate(it["options"]) if k != it["correct"]]
        if it["mode"] == "match":
            assert right.split(" · ")[0] == teams, (right, teams)
            assert all(o.split(" · ")[0] != teams or o != right for o in wrong)
            assert sum(1 for e in it["events"] if e["kind"] == "goal") == h + a
            assert it["events"][[e["kind"] for e in it["events"]].index("goal")]["score"] in ([1, 0], [0, 1])
            last = [e for e in it["events"] if e["kind"] == "goal"][-1]["score"]
            assert last == [h, a], (last, h, a)
        else:
            assert right == f"{h}-{a}" and f"{h}-{a}" not in wrong
            assert it["heading"].startswith(teams)


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

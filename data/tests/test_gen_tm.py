import datetime as dt

from trivela_data.gen_tm import clean_club, fee_label, season_label, window_label


def test_club_names_are_short():
    assert clean_club("Associazione Sportiva Roma") == "Roma"
    assert clean_club("Inter Milan") == "Inter"
    assert clean_club("Società Sportiva Lazio S.p.A.") == "Lazio"


def test_labels():
    assert fee_label(20_900_000) == "20,9 mln €"
    assert fee_label(800_000) == "800 mila €"
    assert window_label(dt.date(2022, 8, 1)) == "Estate 2022"
    assert window_label(dt.date(2024, 1, 20)) == "Inverno 2024"
    assert season_label(2015) == "2015/16"

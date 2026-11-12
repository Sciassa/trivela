from trivela_data.postprocess import is_show_case


def test_show_cases_are_excluded():
    assert is_show_case({"question": "Chi segnò nel giorno del suo compleanno?", "options": ["El Shaarawy"]})
    assert is_show_case({"title": "Doppi ex: giocatori con Real Madrid e Roma"})
    assert is_show_case({"match": "Inter-Juventus", "date": "14 febbraio 2026"})


def test_new_questions_are_kept():
    assert not is_show_case({"question": "Chi arbitrò Italia-Germania?", "options": ["A", "B", "C", "D"]})
    assert not is_show_case({"title": "Doppi ex: giocatori con Napoli e Torino"})

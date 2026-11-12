from trivela_data.text import best_match, name_score, norm, same_club, same_place
from trivela_data.wiki import parse_football_boxes, parse_goals, parse_squads, team_code

BOX = """
<section begin=E1 />{{#invoke:Football box|main
|date={{Start date|2006|6|12|df=y}}
|team1={{fb-rt|USA}}
|score={{score link|2006 FIFA World Cup Group E#United States vs Czech Republic|0–3}}
|team2={{#invoke:flagg|main|unpe|avar=fb|CZE}}
|goals1=
|goals2=
*[[Jan Koller|Koller]] {{goal|5}}
*[[Tomáš Rosický|Rosický]] {{goal|36||76}}
|stadium=[[Arena AufSchalke]], [[Gelsenkirchen]]
|attendance=52,000
|referee=[[Carlos Amarilla]] ([[Paraguayan Football Association|Paraguay]])
}}
{| style="font-size: 90%" cellspacing="0" cellpadding="0"
|GK ||'''18'''||[[Kasey Keller]]
|RB ||'''6''' ||[[Steve Cherundolo]] || || {{suboff|46}}
|CB ||'''23'''||[[Eddie Pope]]
|CB ||'''22'''||[[Oguchi Onyewu]]
|LB ||'''7''' ||[[Eddie Lewis (American soccer)|Eddie Lewis]]
|RM ||'''17'''||[[DaMarcus Beasley]]
|CM ||'''10'''||[[Claudio Reyna]] ([[Captain (association football)|c]])
|CM ||'''4''' ||[[Pablo Mastroeni]]
|LM ||'''15'''||[[Bobby Convey]]
|AM ||'''21'''||[[Landon Donovan]]
|CF ||'''20'''||[[Brian McBride]]
|colspan=3|'''Substitutions:'''
|FW ||'''9''' ||[[Eddie Johnson (American soccer)|Eddie Johnson]]
|}
"""


def test_football_box():
    [m] = parse_football_boxes("p", BOX)
    assert m.date == "2006-06-12"
    assert (m.code1, m.code2) == ("USA", "CZE")
    assert m.score == (0, 3)
    assert [(g.title, g.minute) for g in m.goals2] == [("Jan Koller", 5), ("Tomáš Rosický", 36), ("Tomáš Rosický", 76)]
    assert m.city == "Gelsenkirchen" and m.referee == "Carlos Amarilla" and m.attendance == 52000
    starters = [p for p in m.lineups[0] if p.starter]
    assert len(starters) == 11 and starters[6].captain


def test_goal_flags():
    gs = parse_goals("[[A B|B]] {{goal|90+3|pen.}} [[C D]] {{goal|12|o.g.}}")
    assert (gs[0].minute, gs[0].extra, gs[0].penalty) == (90, 3, True)
    assert gs[1].own_goal


def test_squads():
    text = "===Italy===\n{{nat fs g player|no=10|pos=FW|name=[[Francesco Totti]]|club=[[A.S. Roma|Roma]]}}"
    [p] = parse_squads(text)
    assert (p.team, p.title, p.number, p.pos, p.club_label) == ("Italy", "Francesco Totti", 10, "FW", "Roma")


def test_team_code_variants():
    assert team_code("{{fb-rt|ITA}}") == "ITA"
    assert team_code("{{#invoke:flagg|main|unpre|avar=fb|QAT}}") == "QAT"


def test_name_matching():
    assert norm("Çalhanoğlu") == "calhanoglu"
    assert name_score("Marco MATERAZZI", "Marco Materazzi") == 1.0
    assert name_score("RONALDO", "Ronaldo (Brazilian footballer)") == 1.0
    assert best_match("Fabio CANNAVARO", ["Fabio Cannavaro", "Paolo Cannavaro"]) == "Fabio Cannavaro"
    assert best_match("CANNAVARO", ["Fabio Cannavaro", "Paolo Cannavaro"]) is None
    assert same_place("Berlin", "Berlin")
    assert same_club("Juventus (ITA)", "Juventus FC")

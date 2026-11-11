"""Wikitext parsing for football boxes, line-up tables and squad lists (English Wikipedia)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

LINK_RE = re.compile(r"\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]")
MINUTE_RE = re.compile(r"^\s*(\d{1,3})\s*(?:\+\s*(\d{1,2}))?\s*'?\s*$")


def find_templates(text: str, name_pattern: str) -> list[tuple[int, int, str]]:
    """Return (start, end, body) of templates whose name matches the regex (brace-aware)."""
    out = []
    rx = re.compile(r"\{\{\s*(?:" + name_pattern + r")\s*(?=[|}])", re.IGNORECASE)
    for m in rx.finditer(text):
        start = m.start()
        depth = 0
        i = start
        while i < len(text) - 1:
            two = text[i:i + 2]
            if two == "{{":
                depth += 1
                i += 2
                continue
            if two == "}}":
                depth -= 1
                i += 2
                if depth == 0:
                    out.append((start, i, text[start + 2:i - 2]))
                    break
                continue
            i += 1
    return out


def split_params(body: str) -> tuple[list[str], dict[str, str]]:
    """Split template body by top-level pipes. Returns (positional, named)."""
    parts: list[str] = []
    depth_t = depth_l = 0
    cur = []
    i = 0
    while i < len(body):
        two = body[i:i + 2]
        if two == "{{":
            depth_t += 1
            cur.append(two)
            i += 2
            continue
        if two == "}}":
            depth_t -= 1
            cur.append(two)
            i += 2
            continue
        if two == "[[":
            depth_l += 1
            cur.append(two)
            i += 2
            continue
        if two == "]]":
            depth_l -= 1
            cur.append(two)
            i += 2
            continue
        ch = body[i]
        if ch == "|" and depth_t == 0 and depth_l == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    parts.append("".join(cur))
    positional: list[str] = []
    named: dict[str, str] = {}
    for p in parts[1:]:  # first part is the template name
        m = re.match(r"^\s*([\w\- ]+?)\s*=(.*)$", p, re.DOTALL)
        if m:
            named[m.group(1).strip().lower()] = m.group(2).strip()
        else:
            positional.append(p.strip())
    return positional, named


def strip_comments(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    text = re.sub(r"<ref[^>/]*/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.DOTALL)
    return text


def links(text: str) -> list[tuple[str, str]]:
    return [(m.group(1).strip(), (m.group(2) or m.group(1)).strip()) for m in LINK_RE.finditer(text)]


def team_code(value: str) -> str | None:
    m = re.search(r"\{\{\s*fb[\w\-]*\s*\|\s*([A-Z]{3})", value)
    if m:
        return m.group(1)
    m = re.search(r"\|\s*([A-Z]{3})\s*(?=[|}])", value)
    return m.group(1) if m else None


def parse_date(value: str) -> str | None:
    m = re.search(r"\{\{\s*start date[^|]*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})", value, re.IGNORECASE)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def parse_score(value: str) -> tuple[int, int] | None:
    v = value
    sl = find_templates(v, r"score link")
    if sl:
        pos, _ = split_params(sl[0][2])
        v = pos[-1] if pos else ""
    m = re.search(r"(\d+)\s*[–\-−]\s*(\d+)", v)
    return (int(m.group(1)), int(m.group(2))) if m else None


@dataclass
class WGoal:
    title: str
    minute: int
    extra: int
    penalty: bool
    own_goal: bool


def parse_goals(value: str) -> list[WGoal]:
    """Sequence of [[player]] links followed by {{goal|..}} templates."""
    goals: list[WGoal] = []
    events: list[tuple[int, str, object]] = []
    for m in LINK_RE.finditer(value):
        events.append((m.start(), "link", m.group(1).strip()))
    for s, _e, body in find_templates(value, r"goal"):
        events.append((s, "goal", body))
    events.sort(key=lambda x: x[0])
    current = None
    for _pos, kind, payload in events:
        if kind == "link":
            current = payload
            continue
        if current is None:
            continue
        pos, _named = split_params(str(payload))
        for p in pos:
            p2 = p.strip().lower()
            mm = MINUTE_RE.match(p2)
            if mm:
                goals.append(WGoal(current, int(mm.group(1)), int(mm.group(2) or 0), False, False))
            elif p2 in ("pen.", "pen", "p", "penalty") and goals:
                goals[-1].penalty = True
            elif p2 in ("o.g.", "og", "o.g", "own goal") and goals:
                goals[-1].own_goal = True
    return goals


@dataclass
class WLineupPlayer:
    title: str
    number: int | None
    pos: str
    starter: bool
    captain: bool


@dataclass
class WMatch:
    page: str
    date: str | None
    code1: str | None
    code2: str | None
    score: tuple[int, int] | None
    goals1: list[WGoal]
    goals2: list[WGoal]
    stadium: str | None
    city: str | None
    referee: str | None
    attendance: int | None
    lineups: list[list[WLineupPlayer]] = field(default_factory=list)


ROW_RE = re.compile(
    r"^\|\s*([A-Z]{2,3})\s*\|\|\s*(?:'''\s*(\d*)\s*'''|(\d*))\s*\|\|\s*(.*)$", re.MULTILINE
)


def parse_lineup_tables(segment: str) -> list[list[WLineupPlayer]]:
    tables = re.split(r"\n\{\|\s*style=", segment)
    out: list[list[WLineupPlayer]] = []
    for t in tables[1:]:
        end = t.find("\n|}")
        body = t[: end if end != -1 else len(t)]
        players: list[WLineupPlayer] = []
        starter = True
        for line in body.split("\n"):
            if "Substitut" in line or "Substitute" in line:
                starter = False
                continue
            m = ROW_RE.match(line.strip())
            if not m:
                continue
            ls = links(m.group(4))
            if not ls:
                continue
            title = ls[0][0]
            if title.lower().startswith("captain"):
                continue
            num = m.group(2) or m.group(3)
            captain = "Captain (association football)" in m.group(4)
            players.append(WLineupPlayer(title, int(num) if num else None, m.group(1), starter, captain))
        if sum(1 for p in players if p.starter) >= 11:
            out.append(players)
        if len(out) == 2:
            break
    return out


def parse_football_boxes(page: str, text: str) -> list[WMatch]:
    text = strip_comments(text)
    boxes = find_templates(text, r"#invoke:\s*football box\s*\|\s*main|football box(?: collapsible)?")
    matches: list[WMatch] = []
    for idx, (start, end, body) in enumerate(boxes):
        _pos, named = split_params(body)
        nxt = boxes[idx + 1][0] if idx + 1 < len(boxes) else len(text)
        stadium = city = None
        sl = links(named.get("stadium", ""))
        if sl:
            stadium = sl[0][0]
            city = sl[1][0] if len(sl) > 1 else None
        ref = links(named.get("referee", ""))
        att = re.sub(r"[^\d]", "", named.get("attendance", "").split("<")[0])
        m = WMatch(
            page=page,
            date=parse_date(named.get("date", "")),
            code1=team_code(named.get("team1", "")),
            code2=team_code(named.get("team2", "")),
            score=parse_score(named.get("score", "")),
            goals1=parse_goals(named.get("goals1", "")),
            goals2=parse_goals(named.get("goals2", "")),
            stadium=stadium,
            city=city,
            referee=ref[0][0] if ref else None,
            attendance=int(att) if att else None,
        )
        m.lineups = parse_lineup_tables(text[end:nxt])
        matches.append(m)
    return matches


@dataclass
class WSquadPlayer:
    team: str
    title: str
    number: int | None
    pos: str
    club_title: str | None
    club_label: str | None
    captain: bool


def parse_squads(text: str) -> list[WSquadPlayer]:
    text = strip_comments(text)
    out: list[WSquadPlayer] = []
    heads = [(m.start(), m.group(2).strip()) for m in re.finditer(r"^(={3,4})\s*([^=]+?)\s*\1\s*$", text, re.MULTILINE)]
    tpls = find_templates(text, r"national football squad player|nat fs g player|nat fs player")
    for s, _e, body in tpls:
        team = None
        for hs, hname in heads:
            if hs < s:
                team = hname
            else:
                break
        if team is None:
            continue
        _pos, named = split_params(body)
        ln = links(named.get("name", ""))
        if not ln:
            continue
        num = re.sub(r"[^\d]", "", named.get("no", ""))
        cl = links(named.get("club", ""))
        out.append(
            WSquadPlayer(
                team=re.sub(r"\[\[|\]\]", "", team),
                title=ln[0][0],
                number=int(num) if num else None,
                pos=named.get("pos", "").strip().upper()[:2],
                club_title=cl[0][0] if cl else None,
                club_label=cl[0][1] if cl else None,
                captain="captain" in named.get("name", "").lower(),
            )
        )
    return out

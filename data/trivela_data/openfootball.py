"""openfootball (public domain) loaders: World Cup matches and squads."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from .paths import OF_DIR


@dataclass
class OGoal:
    name: str
    minute: int
    extra: int
    penalty: bool
    own_goal: bool
    side: int  # 0 = counted for team1, 1 = for team2


@dataclass
class OMatch:
    year: int
    idx: int
    round: str
    date: str
    team1: str
    team2: str
    score: tuple[int, int] | None
    aet: bool
    pens: tuple[int, int] | None
    goals: list[OGoal]
    stadium: str | None
    city: str | None
    starters: list[list[tuple[str, bool]]] = field(default_factory=list)  # (name, captain)
    referee: str | None = None
    attendance: int | None = None
    reds: list[tuple[int, str, int]] = field(default_factory=list)  # (side, name, minute)

    @property
    def url(self) -> str:
        return f"https://github.com/openfootball/worldcup.json/blob/master/{self.year}/worldcup-full.json"


def _minute(g: dict) -> tuple[int, int]:
    raw = str(g.get("minute", "0"))
    m = re.match(r"(\d+)(?:\+(\d+))?", raw)
    base = int(m.group(1)) if m else 0
    extra = int(m.group(2)) if m and m.group(2) else int(g.get("offset", 0) or 0)
    return base, extra


def load_matches(year: int) -> list[OMatch]:
    path = OF_DIR / "worldcup.json" / str(year) / "worldcup-full.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[OMatch] = []
    for i, m in enumerate(data["matches"]):
        sc = m.get("score")
        score = pens = None
        aet = False
        if isinstance(sc, list) and len(sc) == 2:
            score = (int(sc[0]), int(sc[1]))
        elif isinstance(sc, dict):
            if sc.get("et"):
                score = tuple(sc["et"])
                aet = True
            elif sc.get("ft"):
                score = tuple(sc["ft"])
            if sc.get("p"):
                pens = tuple(sc["p"])
        goals: list[OGoal] = []
        for side, key in ((0, "goals1"), (1, "goals2")):
            for g in m.get(key, []) or []:
                mi, ex = _minute(g)
                goals.append(OGoal(g["name"], mi, ex, bool(g.get("penalty")), bool(g.get("owngoal")), side))
        stadium = city = None
        if m.get("ground"):
            parts = [p.strip() for p in m["ground"].split(",")]
            stadium = parts[0]
            city = parts[-1] if len(parts) > 1 else None
        starters: list[list[tuple[str, bool]]] = []
        for lu in m.get("lineup", []) or []:
            starters.append([(p["name"], bool(p.get("captain"))) for p in lu.get("starter", [])])
        reds = []
        for side, bk in enumerate(m.get("bookings", []) or []):
            for b in bk or []:
                if b.get("type") in ("R", "Y2", "YR"):
                    reds.append((side, b["name"], _minute(b)[0]))
        refs = m.get("referees") or []
        out.append(
            OMatch(
                year=year,
                idx=i,
                round=m.get("round", ""),
                date=m["date"],
                team1=m["team1"],
                team2=m["team2"],
                score=score,  # type: ignore[arg-type]
                aet=aet,
                pens=pens,  # type: ignore[arg-type]
                goals=goals,
                stadium=stadium,
                city=city,
                starters=starters,
                referee=refs[0]["name"] if refs else None,
                attendance=int(m["attendance"]) if str(m.get("attendance", "")).isdigit() else None,
                reds=reds,
            )
        )
    return out


@dataclass
class OSquadPlayer:
    year: int
    team: str
    code: str
    number: int | None
    pos: str
    name: str
    caps: int | None
    club: str | None


SQUAD_HEAD = re.compile(r"^==\s*(.+?)\s*\(([A-Z]{3})\)")
SQUAD_ROW = re.compile(r"^\s*(?:\((\d+)\)|-)?\s*(GK|DF|MF|FW)\s+(.+?)\s{2,}##\s*(\d+|-)?\s*,?\s*(.*)$")


def load_squads(year: int) -> list[OSquadPlayer]:
    dirs = sorted((OF_DIR / "worldcup").glob(f"{year}--*"))
    if not dirs or not (dirs[0] / "squads.txt").exists():
        return []
    out: list[OSquadPlayer] = []
    team = code = None
    for line in (dirs[0] / "squads.txt").read_text(encoding="utf-8").splitlines():
        h = SQUAD_HEAD.match(line)
        if h:
            team, code = h.group(1).strip(), h.group(2)
            continue
        r = SQUAD_ROW.match(line)
        if r and team and code:
            club = re.sub(r"\s*\([A-Z]{3}\)\s*$", "", (r.group(5) or "").strip()) or None
            out.append(
                OSquadPlayer(year, team, code, int(r.group(1)) if r.group(1) else None, r.group(2),
                             r.group(3).strip(), int(r.group(4)) if r.group(4) and r.group(4).isdigit() else None, club)
            )
    return out


def squads_url(year: int) -> str:
    dirs = sorted((OF_DIR / "worldcup").glob(f"{year}--*"))
    name = dirs[0].name if dirs else str(year)
    return f"https://github.com/openfootball/worldcup/blob/master/{name}/squads.txt"

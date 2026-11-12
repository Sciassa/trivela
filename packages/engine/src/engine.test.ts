import { describe, expect, it } from "vitest";
import type { PoolGameId } from "@trivela/protocol";
import { createMatch, drawGames, passesYearFilter, reduce, viewFor, POOL } from "./match";
import { Rng } from "./rng";
import { parseTopic, parseYears } from "./topic";
import { createTournament, recordResult, roundRobin, standings } from "./tournament";
import type { Intent, MatchConfig, MatchState } from "./types";
import { makeCtx, makePacks, P } from "./fixtures.test-helpers";

const packs = makePacks();
const ctx = makeCtx(packs);

function start(games: PoolGameId[], over: Partial<MatchConfig> = {}): MatchState {
  const r = createMatch(
    { judging: "auto", players: ["Anna", "Bruno"], yearFrom: null, topics: ["Juventus", "Udinese"], seed: 7, forcedGames: games, ...over },
    packs,
    ctx,
  );
  if (!r.ok) throw new Error(r.reason);
  let s = reduce(r.state, { type: "START" }, ctx);
  s = reduce(s, { type: "BEGIN_GAME" }, ctx);
  return s;
}

const run = (s: MatchState, ...intents: Intent[]) => intents.reduce((acc, i) => reduce(acc, i, ctx), s);
const timeout = (s: MatchState) => reduce(s, { type: "TIMEOUT", timerId: s.timer!.id }, ctx);
const g4: PoolGameId[] = ["tiro_secco", "maglia", "frame", "intruso"];

describe("match flow", () => {
  it("creates a match with 4 games + cassaforte, deterministic per seed", () => {
    const a = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, topics: ["Juve", "Udinese"], seed: 42 }, packs, ctx);
    const b = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, topics: ["Juve", "Udinese"], seed: 42 }, packs, ctx);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.state.order).toEqual(b.state.order);
      expect(a.state.order).toHaveLength(5);
      expect(a.state.order[4]).toBe("cassaforte");
    }
  });

  it("refuses non-football topics", () => {
    const r = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, topics: ["la pizza margherita", "Juve"], seed: 1, forcedGames: g4 }, packs, ctx);
    expect(r.ok).toBe(false);
  });

  it("lets the trailing player start the next game", () => {
    let s = start(["tiro_secco", "maglia", "frame", "intruso"]);
    const first = s.game!.turn;
    // first player answers right, second wrong, then everyone times out
    s = run(s, { type: "ANSWER", payload: { choice: 1 } }, { type: "NEXT" }, { type: "ANSWER", payload: { choice: 0 } }, { type: "NEXT" });
    while (s.phase === "playing") {
      s = s.game!.stage === "ask" ? timeout(s) : run(s, { type: "NEXT" });
    }
    expect(s.scores[first]).toBe(2);
    s = run(s, { type: "NEXT" });
    expect(s.starters[1]).toBe(first === 0 ? 1 : 0);
  });

  it("hides answers from the screen view", () => {
    const s = start(["tiro_secco", "maglia", "frame", "intruso"]);
    const v = viewFor(s, "screen");
    expect(v.content).toEqual({});
    expect(v.game!.items[v.game!.i].correct).toBe(-1);
    expect(v.game!.items[v.game!.i + 1]).toBeNull();
    expect(viewFor(s, "host").game!.items[0].correct).toBe(1);
  });
});

describe("year filter", () => {
  const item = { yearMin: 1998, yearMax: 2003, activeYears: [2001, 2006] } as never;
  it("applies to events and persons, not to lists or topics", () => {
    expect(passesYearFilter("tiro_secco", item, 2000)).toBe(false);
    expect(passesYearFilter("giramondo", item, 2000)).toBe(true);
    expect(passesYearFilter("intruso", item, 2002)).toBe(false);
    expect(passesYearFilter("decina", item, 2020)).toBe(true);
    expect(passesYearFilter("dischetto", item, 2020)).toBe(true);
    expect(passesYearFilter("asta", item, 2020)).toBe(true);
    expect(passesYearFilter("prima_pagina", item, 2020)).toBe(true);
    expect(passesYearFilter("cassaforte", item, 2020)).toBe(true);
  });
});

describe("draw", () => {
  it("respects group constraints and opener slot", () => {
    for (let seed = 1; seed < 200; seed++) {
      const d = drawGames(new Rng(seed), POOL);
      expect(new Set(d).size).toBe(4);
      expect(d.filter((g) => g === "mercato" || g === "giramondo").length).toBeLessThanOrEqual(1);
      expect(d.filter((g) => ["decina", "dischetto", "asta"].includes(g)).length).toBeLessThanOrEqual(1);
      expect(["tiro_secco", "frame", "maglia", "intruso", "mappamondo"]).toContain(d[0]);
    }
  });
});

describe("tiro secco", () => {
  it("alternates 8 questions, +2 per correct answer", () => {
    let s = start(g4);
    const turns: number[] = [];
    for (let k = 0; k < 8; k++) {
      turns.push(s.game!.turn);
      s = run(s, { type: "ANSWER", payload: { choice: 1 } }, { type: "NEXT" });
    }
    expect(turns).toEqual([0, 1, 0, 1, 0, 1, 0, 1].map((x) => (x === 0 ? turns[0] : 1 - turns[0]!)));
    expect(s.scores).toEqual([8, 8]);
    expect(s.phase).toBe("game_over");
  });
});

describe("il mercato", () => {
  it("awards points of the current clue and frees the other player after a wrong answer", () => {
    let s = start(["mercato", "maglia", "frame", "intruso"]);
    s = timeout(s); // ready -> clue 1
    expect(s.game!.revealed).toBe(1);
    s = timeout(s); // clue 2
    s = run(s, { type: "BUZZ", player: 0 }, { type: "ANSWER", player: 0, payload: { text: "Mario Ulivo" } });
    expect(s.game!.out[0]).toBe(true);
    expect(s.game!.free).toBe(true);
    s = run(s, { type: "REVEAL_CLUE" }, { type: "REVEAL_CLUE" }); // clue 4
    const target = (s.game!.items[0].answer.display as string);
    s = run(s, { type: "BUZZ", player: 1 }, { type: "ANSWER", player: 1, payload: { text: target } });
    expect(s.scores).toEqual([0, 5]);
  });

  it("ignores buzzes after a false start until the next clue", () => {
    let s = start(["mercato", "maglia", "frame", "intruso"]);
    s = run(s, { type: "BUZZ", player: 1 });
    expect(s.events[0]).toMatchObject({ type: "false_start", player: 1 });
    s = timeout(s);
    expect(s.game!.locked).toEqual([false, false]);
  });
});

describe("la decina", () => {
  it("stops at the 10th correct answer", () => {
    let s = start(["decina", "maglia", "frame", "intruso"]);
    for (let k = 0; k < 10; k++) {
      s = run(s, { type: "ANSWER", payload: { text: P(k).name } });
      if (s.game!.stage === "feedback") s = timeout(s);
    }
    expect(s.game!.stage).toBe("final");
    expect(s.scores[0] + s.scores[1]).toBe(20);
  });

  it("knocks a player out after two errors; repeating a name is an error", () => {
    let s = start(["decina", "maglia", "frame", "intruso"]);
    const a = s.game!.turn;
    s = run(s, { type: "ANSWER", payload: { text: P(0).name } });
    s = timeout(s);
    s = run(s, { type: "ANSWER", payload: { text: P(0).name } }); // b repeats: error 1
    s = timeout(s);
    s = timeout(s); // a times out: error 1
    s = timeout(s);
    s = timeout(s); // b error 2 -> out
    s = timeout(s);
    expect(s.game!.out[1 - a]).toBe(true);
    expect(s.game!.turn).toBe(a);
  });
});

describe("dal dischetto", () => {
  it("closes the tenth place after one of the tied names", () => {
    let s = start(["dischetto", "maglia", "frame", "intruso"]);
    s = run(s, { type: "ANSWER", payload: { text: P(9).name } });
    expect(s.events[0]).toMatchObject({ type: "goal", points: 2 });
    s = timeout(s);
    s = run(s, { type: "ANSWER", payload: { text: P(10).name } });
    expect(s.events[0]).toMatchObject({ type: "miss" });
    for (let k = 0; k < 8; k++) {
      s = timeout(s);
      if (s.game!.stage === "ask") s = timeout(s);
    }
    expect(s.game!.shots).toEqual([5, 5]);
  });
});

describe("la formazione", () => {
  it("scores 15/10/5/3/2/0", () => {
    let s = start(["formazione", "maglia", "frame", "intruso"]);
    s = run(s, { type: "CHOOSE", value: 0 });
    const team = s.game!.item.teams[0];
    const hidden = team.players.filter((p: { hidden: boolean }) => p.hidden);
    for (const h of hidden.slice(0, 4)) s = run(s, { type: "ANSWER", payload: { text: h.name } });
    s = run(s, { type: "FINISH" });
    expect(s.scores[s.game!.turn]).toBe(10);
  });
});

describe("la cassaforte", () => {
  it("applies inverse malus and can go negative", () => {
    let s = start(g4);
    s = { ...s, phase: "game_over", gameIdx: 3 };
    s = run(s, { type: "NEXT" }, { type: "BEGIN_GAME" });
    expect(s.game!.game).toBe("cassaforte");
    const p = s.game!.picks[0];
    s = run(s, { type: "CHOOSE", value: 1 }, { type: "ANSWER", payload: { text: "sbagliato del tutto" } });
    expect(s.scores[p]).toBe(-30);
    s = run(s, { type: "NEXT" }, { type: "CHOOSE", value: 3 }, { type: "VERDICT", payload: { correct: true } });
    expect(s.scores[1 - p]).toBe(30);
  });
});

describe("l'asta", () => {
  it("winner must deliver; failure gives +5 to the opponent", () => {
    let s = start(["asta", "maglia", "frame", "intruso"]);
    const a = s.game!.turn;
    s = run(s, { type: "BID", player: a, amount: 3 }, { type: "PASS", player: 1 - a } as Intent);
    expect(s.game!.stage).toBe("proving");
    s = run(s, { type: "ANSWER", payload: { text: P(0).name } }, { type: "FINISH" });
    expect(s.scores[1 - a]).toBe(5);
    s = run(s, { type: "NEXT" });
    const b = s.game!.turn;
    s = run(s, { type: "BID", player: b, amount: 2 }, { type: "PASS", player: 1 - b } as Intent);
    s = run(s, { type: "ANSWER", payload: { text: P(4).name } }, { type: "ANSWER", payload: { text: P(5).name } });
    expect(s.game!.stage).toBe("reveal");
  });
});

describe("il filo rosso", () => {
  it("rewards the optimal chain", () => {
    let s = start(["filo_rosso", "maglia", "frame", "intruso"]);
    s = run(s, { type: "ANSWER", payload: { chain: [P(1).name] } });
    expect(s.game!.last.points).toBe(10);
    s = run(s, { type: "NEXT" }, { type: "ANSWER", payload: { chain: [P(2).name, P(4).name] } });
    expect(s.game!.last.points).toBe(5);
  });
});

describe("frame and mappamondo", () => {
  it("frame: exact +3, bonus +2", () => {
    let s = start(["frame", "maglia", "tiro_secco", "intruso"]);
    s = run(s, { type: "ANSWER", payload: { score: [2, 1], scorer: P(1).name } });
    expect(s.game!.last.points).toBe(5);
    s = run(s, { type: "NEXT" }, { type: "ANSWER", payload: { score: [3, 0] } });
    expect(s.game!.last.points).toBe(1);
  });

  it("mappamondo: distance bands", () => {
    let s = start(["mappamondo", "maglia", "tiro_secco", "intruso"]);
    s = run(s, { type: "ANSWER", payload: { lat: 45.1, lon: 7.7 } });
    expect(s.game!.last.points).toBe(5);
    s = run(s, { type: "NEXT" }, { type: "ANSWER", payload: { lat: 45.46, lon: 9.19 } });
    expect(s.game!.last.points).toBe(1);
  });
});

describe("topic", () => {
  it("parses seasons and decades", () => {
    expect(parseYears("La Juve di Conte 2011/12")).toEqual([2011, 2011]);
    expect(parseYears("L'Udinese degli anni 2000")).toEqual([2000, 2009]);
    expect(parseYears("anni '90")).toEqual([1990, 1999]);
  });
  it("maps free text to entities", () => {
    const t = parseTopic("La Juve 2011/12", ctx.index);
    expect(t.seeds).toContain("c1");
    expect(t.years).toEqual([2011, 2011]);
    expect(parseTopic("la pizza margherita", ctx.index).status).toBe("unknown");
  });
});

describe("tournament", () => {
  it("round robin pairs everybody once", () => {
    expect(roundRobin(4)).toHaveLength(6);
    expect(roundRobin(5)).toHaveLength(10);
  });
  it("sums points (negative allowed), top 4 to semis, then final", () => {
    let t = createTournament(["A", "B", "C", "D", "E"]);
    for (const m of t.matches.filter((x) => x.stage === "league")) {
      t = recordResult(t, m.id, m.a * 10 - 25, m.b * 10 - 25);
    }
    expect(t.phase).toBe("semi");
    const table = standings(t);
    expect(table[0]!.name).toBe("E");
    expect(table[4]!.points).toBeLessThan(0);
    const semis = t.matches.filter((m) => m.stage === "semi");
    expect(semis.map((m) => [m.a, m.b])).toEqual([[4, 1], [3, 2]]);
    for (const m of semis) t = recordResult(t, m.id, 10, 5);
    expect(t.phase).toBe("final");
    t = recordResult(t, t.matches.find((m) => m.stage === "final")!.id, 3, 4);
    expect(t.phase).toBe("done");
  });
});

import { describe, expect, it } from "vitest";
import type { GameId } from "@trivela/protocol";
import { MODULES } from "./games";
import { createMatch, drawGames, GAMES_PER_MATCH, itemsNeeded, passesYearFilter, POOL, reduce, sampleVaried, viewFor } from "./match";
import { Rng } from "./rng";
import { createTournament, recordResult, roundRobin, standings } from "./tournament";
import type { Intent, MatchConfig, MatchState } from "./types";
import { makeCtx, makePacks, meta, P } from "./fixtures.test-helpers";

const packs = makePacks();
const ctx = makeCtx(packs);
const g5: GameId[] = ["tiro_secco", "maglia", "frame", "prima_pagina", "decina"];

function start(games: GameId[], over: Partial<MatchConfig> = {}): MatchState {
  const r = createMatch({ judging: "auto", players: ["Anna", "Bruno"], yearFrom: null, seed: 7, forcedGames: games, ...over }, packs);
  if (!r.ok) throw new Error(r.reason);
  let s = reduce(r.state, { type: "START" }, ctx);
  s = reduce(s, { type: "BEGIN_GAME" }, ctx);
  return s;
}
const run = (s: MatchState, ...intents: Intent[]) => intents.reduce((acc, i) => reduce(acc, i, ctx), s);
const timeout = (s: MatchState) => reduce(s, { type: "TIMEOUT", timerId: s.timer!.id }, ctx);
const first = (g: GameId) => [g, ...g5.filter((x) => x !== g)].slice(0, 5) as GameId[];

describe("match flow", () => {
  it("draws five games out of ten, deterministically per seed, with no fixed final", () => {
    const cfg = { judging: "auto" as const, players: ["A", "B"] as [string, string], yearFrom: null, seed: 42 };
    const a = createMatch(cfg, packs);
    const b = createMatch(cfg, packs);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.state.order).toEqual(b.state.order);
      expect(a.state.order).toHaveLength(GAMES_PER_MATCH);
      expect(new Set(a.state.order).size).toBe(5);
    }
    expect(POOL).toHaveLength(10);
  });

  it("limits the rounds: at most two per player, one list per game", () => {
    expect(itemsNeeded("tiro_secco")).toBe(4);
    expect(itemsNeeded("frame")).toBe(4);
    expect(itemsNeeded("maglia")).toBe(4);
    expect(itemsNeeded("prima_pagina")).toBe(2);
    expect(itemsNeeded("mercato")).toBe(2);
    expect(itemsNeeded("giramondo")).toBe(2);
    expect(itemsNeeded("asta")).toBe(2);
    expect(itemsNeeded("decina")).toBe(1);
    expect(itemsNeeded("dischetto")).toBe(1);
    expect(itemsNeeded("formazione")).toBe(1);
    expect(Object.keys(MODULES)).toHaveLength(10);
  });

  it("lets the trailing player start the next game", () => {
    let s = start(g5);
    const p0 = s.game!.turn;
    s = run(s, { type: "ANSWER", payload: { choice: 1 } }, { type: "NEXT" }, { type: "ANSWER", payload: { choice: 0 } }, { type: "NEXT" });
    while (s.phase === "playing") s = s.game!.stage === "ask" ? timeout(s) : run(s, { type: "NEXT" });
    expect(s.scores[p0]).toBe(2);
    s = run(s, { type: "NEXT" });
    expect(s.starters[1]).toBe(p0 === 0 ? 1 : 0);
  });

  it("hides answers from the screen view", () => {
    const s = start(g5);
    const v = viewFor(s, "screen");
    expect(v.content).toEqual({});
    expect(v.game!.items[v.game!.i].correct).toBe(-1);
    expect(v.game!.items[v.game!.i + 1]).toBeNull();
    expect(viewFor(s, "host").game!.items[0].correct).toBe(1);
  });

  it("ends the match after the fifth game", () => {
    let s = start(g5);
    let guard = 0;
    while (s.phase !== "match_over" && guard++ < 500) {
      if (s.phase === "intro") s = run(s, { type: "BEGIN_GAME" });
      else if (s.timer) s = timeout(s);
      else if (s.game?.stage === "choose") s = run(s, { type: "CHOOSE", value: 0 });
      else s = run(s, { type: "NEXT" });
    }
    expect(s.phase).toBe("match_over");
    expect(s.gameIdx).toBe(5);
  });
});

describe("year filter and sampling", () => {
  const item = { yearMin: 2014, yearMax: 2018, activeYears: [2021] } as never;
  it("applies to events and careers, not to lists", () => {
    expect(passesYearFilter("tiro_secco", item, 2015)).toBe(false);
    expect(passesYearFilter("prima_pagina", item, 2015)).toBe(false);
    expect(passesYearFilter("giramondo", item, 2020)).toBe(true);
    expect(passesYearFilter("decina", item, 2025)).toBe(true);
    expect(passesYearFilter("dischetto", item, 2025)).toBe(true);
    expect(passesYearFilter("asta", item, 2025)).toBe(true);
  });
  it("alternates question types regardless of how many instances each has", () => {
    const items = [...Array.from({ length: 50 }, () => meta({ generator: "big" })), meta({ generator: "rare1" }), meta({ generator: "rare2" }), meta({ generator: "rare3" })];
    const picked = sampleVaried(items, 4, new Rng(3), new Set())!;
    expect(new Set(picked.map((p) => p.generator)).size).toBe(4);
  });
  it("respects draw constraints", () => {
    for (let seed = 1; seed < 200; seed++) {
      const d = drawGames(new Rng(seed), POOL);
      expect(new Set(d).size).toBe(5);
      expect(d.filter((g) => g === "mercato" || g === "giramondo").length).toBeLessThanOrEqual(1);
      expect(d.filter((g) => ["decina", "dischetto", "asta"].includes(g)).length).toBeLessThanOrEqual(1);
      expect(["tiro_secco", "frame", "maglia"]).toContain(d[0]);
    }
  });
});

describe("tiro secco and maglia", () => {
  it("two questions each, +2 per correct answer", () => {
    let s = start(g5);
    for (let k = 0; k < 4; k++) s = run(s, { type: "ANSWER", payload: { choice: 1 } }, { type: "NEXT" });
    expect(s.scores).toEqual([4, 4]);
    expect(s.phase).toBe("game_over");
  });
  it("maglia: the answer is the shirt number, hidden from the screen", () => {
    let s = start(first("maglia"));
    const item = s.game!.items[0];
    expect(viewFor(s, "screen").game!.items[0].answer.display).toBe("");
    s = run(s, { type: "ANSWER", payload: { text: String(item.answer.value) } });
    expect(s.game!.last.points).toBe(3);
    s = run(s, { type: "NEXT" }, { type: "ANSWER", payload: { text: "98" } });
    expect(s.game!.last.points).toBe(0);
  });
});

describe("il mercato", () => {
  it("two profiles; points of the current clue; a wrong answer frees the opponent", () => {
    let s = start(first("mercato"));
    expect(s.game!.items).toHaveLength(2);
    s = timeout(s);
    s = timeout(s);
    s = run(s, { type: "BUZZ", player: 0 }, { type: "ANSWER", player: 0, payload: { text: "Mario Ulivo" } });
    if (!s.game!.out[0]) throw new Error("expected player 0 to be out");
    s = run(s, { type: "REVEAL_CLUE" }, { type: "REVEAL_CLUE" });
    const target = s.game!.items[0].answer.display as string;
    s = run(s, { type: "BUZZ", player: 1 }, { type: "ANSWER", player: 1, payload: { text: target } });
    expect(s.scores).toEqual([0, 5]);
  });
});

describe("la decina e dal dischetto", () => {
  it("decina stops at the 10th correct answer", () => {
    let s = start(first("decina"));
    for (let k = 0; k < 10; k++) {
      s = run(s, { type: "ANSWER", payload: { text: P(k).name } });
      if (s.game!.stage === "feedback") s = timeout(s);
    }
    expect(s.game!.stage).toBe("final");
    expect(s.scores[0] + s.scores[1]).toBe(20);
  });
  it("dischetto: five kicks each on one list, tied names share the places left in the top 10", () => {
    let s = start(first("dischetto"));
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

describe("la formazione, l'asta, il frame", () => {
  it("formazione scores 15/10/5/3/2/0", () => {
    let s = start(first("formazione"));
    s = run(s, { type: "CHOOSE", value: 0 });
    const hidden = s.game!.item.teams[0].players.filter((p: { hidden: boolean }) => p.hidden);
    for (const h of hidden.slice(0, 4)) s = run(s, { type: "ANSWER", payload: { text: h.name } });
    s = run(s, { type: "FINISH" });
    expect(s.scores[s.game!.turn]).toBe(10);
  });
  it("asta: the winner must deliver; failure gives +5 to the opponent", () => {
    let s = start(first("asta"));
    const a = s.game!.turn;
    s = run(s, { type: "BID", player: a, amount: 3 }, { type: "PASS", player: 1 - a } as Intent);
    s = run(s, { type: "ANSWER", payload: { text: P(0).name } }, { type: "FINISH" });
    expect(s.scores[1 - a]).toBe(5);
  });
  it("frame: exact +3, bonus +2, sign only +1", () => {
    let s = start(first("frame"));
    s = run(s, { type: "ANSWER", payload: { score: [2, 1], scorer: P(1).name } });
    expect(s.game!.last.points).toBe(5);
    s = run(s, { type: "NEXT" }, { type: "ANSWER", payload: { score: [3, 0] } });
    expect(s.game!.last.points).toBe(1);
  });
});

describe("tournament", () => {
  it("round robin pairs everybody once", () => {
    expect(roundRobin(4)).toHaveLength(6);
    expect(roundRobin(5)).toHaveLength(10);
  });
  it("sums points, top 4 to semis, then final", () => {
    let t = createTournament(["A", "B", "C", "D", "E"]);
    for (const m of t.matches.filter((x) => x.stage === "league")) t = recordResult(t, m.id, m.a * 10, m.b * 10);
    expect(t.phase).toBe("semi");
    expect(standings(t)[0]!.name).toBe("E");
    for (const m of t.matches.filter((x) => x.stage === "semi")) t = recordResult(t, m.id, 10, 5);
    t = recordResult(t, t.matches.find((m) => m.stage === "final")!.id, 3, 4);
    expect(t.phase).toBe("done");
  });
});

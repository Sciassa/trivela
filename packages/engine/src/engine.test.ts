import { describe, expect, it } from "vitest";
import type { GameId } from "@trivela/protocol";
import { MODULES } from "./games";
import { createMatch, drawGames, eligibleItems, GAMES_PER_MATCH, itemsNeeded, passesLeagueFilter, passesYearFilter, POOL, reduce, sampleVaried, singleGamePlan, viewFor } from "./match";
import { Rng } from "./rng";
import { createTournament, recordResult, roundRobin, standings } from "./tournament";
import type { Intent, MatchConfig, MatchState } from "./types";
import { makeCtx, makePacks, meta, P } from "./fixtures.test-helpers";

const packs = makePacks();
const ctx = makeCtx(packs);
const g5: GameId[] = ["tiro_secco", "maglia", "anomalia", "decina", "dischetto"];

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
  it("draws five games out of nine, deterministically per seed, with no fixed final", () => {
    const cfg = { judging: "auto" as const, players: ["A", "B"] as [string, string], yearFrom: null, seed: 42 };
    const a = createMatch(cfg, packs);
    const b = createMatch(cfg, packs);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.state.order).toEqual(b.state.order);
      expect(a.state.order).toHaveLength(GAMES_PER_MATCH);
      expect(new Set(a.state.order).size).toBe(5);
    }
    expect(POOL).toHaveLength(9);
  });

  it("limits the rounds: at most two per player, one list per game", () => {
    expect(itemsNeeded("tiro_secco")).toBe(4);
    expect(itemsNeeded("anomalia")).toBe(4);
    expect(itemsNeeded("maglia")).toBe(4);
    expect(itemsNeeded("mercato")).toBe(2);
    expect(itemsNeeded("giramondo")).toBe(2);
    expect(itemsNeeded("asta")).toBe(2);
    expect(itemsNeeded("decina")).toBe(1);
    expect(itemsNeeded("dischetto")).toBe(1);
    expect(itemsNeeded("formazione")).toBe(1);
    expect(Object.keys(MODULES)).toHaveLength(9);
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
    expect(v.content).toEqual([]);
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
    expect(passesYearFilter("anomalia", item, 2015)).toBe(false);
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
      expect(["tiro_secco", "anomalia", "maglia"]).toContain(d[0]);
    }
  });
});

describe("league filter", () => {
  const tag = (...comps: string[]) => meta({ entities: comps.map((c) => `comp:${c}`) });
  it("keeps what belongs to a selected league and what belongs to no league", () => {
    expect(passesLeagueFilter(tag("IT1"), ["IT1"])).toBe(true);
    expect(passesLeagueFilter(tag("GB1"), ["IT1"])).toBe(false);
    expect(passesLeagueFilter(tag("IT1", "GB1"), ["GB1"])).toBe(true); // a transfer between two leagues
    expect(passesLeagueFilter(tag("CIT"), ["IT1"])).toBe(true); // Coppa Italia follows Serie A
    expect(passesLeagueFilter(tag("CIT"), ["FR1"])).toBe(false);
    expect(passesLeagueFilter(tag("FIWC"), ["FR1"])).toBe(true); // World Cup: always
    expect(passesLeagueFilter(tag("CL"), ["FR1"])).toBe(true); // Champions League: always
    expect(passesLeagueFilter(tag("GB1"), null)).toBe(true);
    expect(passesLeagueFilter(tag("GB1"), undefined)).toBe(true);
  });
  it("applies to the questions drawn for a match", () => {
    const p = makePacks();
    p.items.tiro_secco.forEach((q, k) => (q.entities = [k % 2 ? "comp:IT1" : "comp:GB1"]));
    const only = eligibleItems("tiro_secco", p, { judging: "auto", players: ["A", "B"], yearFrom: null, seed: 1, leagues: ["GB1"] });
    expect(only).toHaveLength(10);
    const r = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed: 1, leagues: ["GB1"], forcedGames: ["tiro_secco", "maglia", "anomalia", "decina", "dischetto"] }, p);
    expect(r.ok && (r.state.content[0] as { entities: string[] }[]).every((q) => q.entities[0] === "comp:GB1")).toBe(true);
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

describe("la formazione, l'asta, le domande a 4 opzioni", () => {
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
  it("the four-option games: every wrong option is wrong, and only the right one scores", () => {
    for (const game of ["anomalia", "tiro_secco"] as const) {
      const right = game === "anomalia" ? 3 : 1;
      for (const choice of [0, 1, 2, 3]) {
        const s0 = start(first(game));
        const s1 = run(s0, { type: "ANSWER", payload: { choice } });
        expect(s1.game!.last!.ok, `${game} option ${choice}`).toBe(choice === right);
        expect(s1.game!.last!.points, `${game} option ${choice}`).toBe(choice === right ? (game === "tiro_secco" ? 2 : 3) : 0);
        expect(s1.game!.last!.said, `${game} option ${choice}`).toBe(choice === right ? undefined : s0.game!.items[0].options[choice]);
      }
    }
    // an answer that is not one of the four options is ignored, never judged
    const s0 = start(first("anomalia"));
    for (const choice of [-1, 4, 1.5, Number.NaN]) expect(run(s0, { type: "ANSWER", payload: { choice } }).game!.last).toBeNull();
  });
  it("anomalia: four questions, +3 each, the answer stays hidden from the screen", () => {
    let s = start(first("anomalia"));
    expect(s.game!.items).toHaveLength(4);
    expect(viewFor(s, "screen").game!.items[0].correct).toBe(-1);
    for (let k = 0; k < 4; k++) s = run(s, { type: "ANSWER", payload: { choice: 3 } }, { type: "NEXT" });
    expect(s.scores).toEqual([6, 6]);
  });
});

describe("wrong answers are kept so the Screen can show them", () => {
  it("maglia, decina, dischetto, mercato, formazione and asta remember what was typed", () => {
    let s = start(first("maglia"));
    s = run(s, { type: "ANSWER", payload: { text: "98" } });
    expect(s.game!.last).toMatchObject({ ok: false, said: "98" });

    s = start(first("decina"));
    s = run(s, { type: "ANSWER", payload: { text: "Mario Fantasma" } });
    expect(s.game!.last).toMatchObject({ ok: false, said: "Mario Fantasma" });

    s = start(first("dischetto"));
    s = run(s, { type: "ANSWER", payload: { text: "Mario Fantasma" } });
    expect(s.game!.last).toMatchObject({ ok: false, said: "Mario Fantasma" });

    s = start(first("mercato"));
    s = timeout(s);
    s = timeout(s);
    s = run(s, { type: "BUZZ", player: 0 }, { type: "ANSWER", player: 0, payload: { text: "Mario Fantasma" } });
    expect(s.game!.last).toMatchObject({ ok: false, said: "Mario Fantasma" });

    s = start(first("formazione"));
    s = run(s, { type: "CHOOSE", value: 0 }, { type: "ANSWER", payload: { text: "Mario Fantasma" } });
    expect(s.game!.wrong).toMatchObject({ text: "Mario Fantasma" });
    s = run(s, { type: "ANSWER", payload: { text: s.game!.item.teams[0].players.find((p: { hidden: boolean }) => p.hidden).name } });
    expect(s.game!.wrong).toBeNull();

    s = start(first("asta"));
    const a = s.game!.turn;
    s = run(s, { type: "BID", player: a, amount: 3 }, { type: "PASS", player: 1 - a } as Intent, { type: "ANSWER", payload: { text: "Mario Fantasma" } });
    expect(s.game!.wrong).toMatchObject({ text: "Mario Fantasma" });
  });
  it("a timeout or a verdict from the host has nothing to show", () => {
    const s = timeout(start(g5));
    expect(s.game!.last).toMatchObject({ ok: false });
    expect(s.game!.last!.said).toBeUndefined();
  });
});

describe("single-game formats", () => {
  const quick = (game: GameId, over: Partial<MatchConfig> = {}) => {
    const r = createMatch({ judging: "auto", players: ["Anna", "Bruno"], yearFrom: null, seed: 5, forcedGames: [game], rounds: 3, ...over }, packs);
    if (!r.ok) throw new Error(r.reason);
    return r.state;
  };
  it("sfida rapida: three rounds each, whatever the game", () => {
    expect(singleGamePlan("tiro_secco", { rounds: 3 })).toEqual({ order: ["tiro_secco"], need: 6 });
    expect(singleGamePlan("anomalia", { rounds: 3 })).toEqual({ order: ["anomalia"], need: 6 });
    expect(singleGamePlan("mercato", { rounds: 3 })).toEqual({ order: ["mercato"], need: 6 });
    expect(singleGamePlan("asta", { rounds: 3 })).toEqual({ order: ["asta"], need: 6 });
    expect(singleGamePlan("decina", { rounds: 3 })).toEqual({ order: ["decina", "decina", "decina"], need: 1 }); // a list per round
    expect(singleGamePlan("formazione", { rounds: 3 }).order).toHaveLength(3);
    const s = quick("tiro_secco");
    expect(s.order).toEqual(["tiro_secco"]);
    expect(s.content[0]).toHaveLength(6);
    let st = run(reduce(s, { type: "START" }, ctx), { type: "BEGIN_GAME" });
    for (let k = 0; k < 6; k++) st = run(st, { type: "ANSWER", payload: { choice: 1 } }, { type: "NEXT" });
    expect(st.scores).toEqual([6, 6]); // 3 questions each, +2 per right answer
    expect(st.phase).toBe("game_over");
  });
  it("sfida rapida on a list game plays three different lists in a row", () => {
    const s = quick("decina");
    expect(s.order).toEqual(["decina", "decina", "decina"]);
    expect(new Set(s.content.map((c) => (c[0] as { id: string }).id)).size).toBe(3); // never the same list twice
  });
  it("sfida rapida respects the year and league filters, and says so when a game has too few questions", () => {
    const r = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: 2999, seed: 1, forcedGames: ["tiro_secco"], rounds: 3 }, packs);
    expect(r).toEqual({ ok: false, reason: "Contenuti insufficienti per tiro_secco." });
    expect(createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed: 1, rounds: 3 }, packs)).toMatchObject({ ok: false });
  });
  it("allenamento: one player, every turn is his, no opponent anywhere", () => {
    const solo = (game: GameId) => quick(game, { solo: true, rounds: undefined, players: ["Anna", "—"] });
    // quiz: all questions go to player 0
    let s = reduce(reduce(solo("tiro_secco"), { type: "START" }, ctx), { type: "BEGIN_GAME" }, ctx);
    expect(s.starters[0]).toBe(0);
    const turns: number[] = [];
    for (let k = 0; k < 6; k++) {
      turns.push(s.game!.turn);
      s = run(s, { type: "ANSWER", payload: { choice: 1 } }, { type: "NEXT" });
    }
    expect(turns).toEqual([0, 0, 0, 0, 0, 0]);
    expect(s.scores).toEqual([12, 0]);
    expect(s.phase).toBe("game_over");
    // buzzer: the opponent is out from the start, a wrong answer ends the profile
    s = reduce(reduce(solo("mercato"), { type: "START" }, ctx), { type: "BEGIN_GAME" }, ctx);
    expect(s.game!.out).toEqual([false, true]);
    s = timeout(s);
    s = timeout(s);
    s = run(s, { type: "BUZZ", player: 0 }, { type: "ANSWER", player: 0, payload: { text: "Mario Fantasma" } });
    expect(s.game!.stage).toBe("reveal");
    // list: alone until the second mistake
    s = reduce(reduce(solo("decina"), { type: "START" }, ctx), { type: "BEGIN_GAME" }, ctx);
    for (let k = 0; k < 2; k++) {
      s = run(s, { type: "ANSWER", payload: { text: "Mario Fantasma" } });
      if (s.game!.stage === "feedback") s = timeout(s);
    }
    expect(s.game!.stage).toBe("final");
    // penalties: five kicks for the one player
    s = reduce(reduce(solo("dischetto"), { type: "START" }, ctx), { type: "BEGIN_GAME" }, ctx);
    for (let k = 0; k < 5; k++) {
      s = run(s, { type: "ANSWER", payload: { text: "Mario Fantasma" } });
      s = timeout(s);
    }
    expect(s.game!.stage).toBe("final");
    expect(s.game!.shots[0]).toBe(5);
    // auction: bidding alone goes straight to proving; failing gives nothing to anybody
    s = reduce(reduce(solo("asta"), { type: "START" }, ctx), { type: "BEGIN_GAME" }, ctx);
    s = run(s, { type: "BID", player: 0, amount: 4 });
    expect(s.game!.stage).toBe("proving");
    s = run(s, { type: "FINISH" });
    expect(s.scores).toEqual([0, 0]);
    // team line-up: a single round
    s = reduce(reduce(solo("formazione"), { type: "START" }, ctx), { type: "BEGIN_GAME" }, ctx);
    s = run(s, { type: "CHOOSE", value: 0 }, { type: "FINISH" }, { type: "NEXT" });
    expect(s.game!.stage).toBe("done");
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

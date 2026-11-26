import { describe, expect, it } from "vitest";
import type { GameId } from "@trivela/protocol";
import { MODULES } from "./games";
import { createMatch, drawGames, eligibleItems, FAMILY_OF, GAMES_PER_MATCH, itemsNeeded, passesLeagueFilter, passesYearFilter, POOL, reduce, sampleVaried, singleGamePlan, subjectsOf, viewFor } from "./match";
import { Rng } from "./rng";
import { createTournament, recordResult, roundRobin, standings } from "./tournament";
import type { Intent, MatchConfig, MatchState } from "./types";
import { makeCtx, makePacks, meta, P } from "./fixtures.test-helpers";

const packs = makePacks();
const ctx = makeCtx(packs);
const g5: GameId[] = ["tiro_secco", "maglia", "formazione", "decina", "dischetto"];

function start(games: GameId[], over: Partial<MatchConfig> = {}): MatchState {
  const r = createMatch({ judging: "auto", players: ["Anna", "Bruno"], yearFrom: null, seed: 7, forcedGames: games, ...over }, packs);
  if (!r.ok) throw new Error(r.reason);
  let s = reduce(r.state, { type: "START" }, ctx);
  s = reduce(s, { type: "BEGIN_GAME" }, ctx);
  return s;
}
const run = (s: MatchState, ...intents: Intent[]) => intents.reduce((acc, i) => reduce(acc, i, ctx), s);
/** The countdown runs out once (a typed answer then gets its grace period). */
const expire = (s: MatchState) => reduce(s, { type: "TIMEOUT", timerId: s.timer!.id }, ctx);
/** The time is really over: countdown and grace period. */
const timeout = (s: MatchState) => {
  const n = expire(s);
  return n.timer?.grace ? expire(n) : n;
};
const first = (g: GameId) => [g, ...g5.filter((x) => x !== g)].slice(0, 5) as GameId[];

describe("match flow", () => {
  it("draws five games out of twelve, deterministically per seed, with no fixed final", () => {
    const cfg = { judging: "auto" as const, players: ["A", "B"] as [string, string], yearFrom: null, seed: 42 };
    const a = createMatch(cfg, packs);
    const b = createMatch(cfg, packs);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.state.order).toEqual(b.state.order);
      expect(a.state.order).toHaveLength(GAMES_PER_MATCH);
      expect(new Set(a.state.order).size).toBe(5);
    }
    expect(POOL).toHaveLength(12);
  });

  it("limits the rounds: at most two per player, one list per game", () => {
    expect(itemsNeeded("tiro_secco")).toBe(4);
    expect(itemsNeeded("maglia")).toBe(4);
    expect(itemsNeeded("mercato")).toBe(2);
    expect(itemsNeeded("giramondo")).toBe(2);
    expect(itemsNeeded("asta")).toBe(2);
    expect(itemsNeeded("decina")).toBe(1);
    expect(itemsNeeded("dischetto")).toBe(1);
    expect(itemsNeeded("formazione")).toBe(1);
    expect(Object.keys(MODULES)).toHaveLength(12);
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
  it("never asks twice about the same person in a match, and rests the people of the last matches", () => {
    // one player fills half of a generator, as Viviano did with five seasons of the same shirt
    const items = [
      ...Array.from({ length: 6 }, () => meta({ generator: "anomala", entities: ["tm:p:1"] })),
      ...Array.from({ length: 6 }, (_, k) => meta({ generator: "anomala", entities: [`tm:p:${10 + k}`] })),
      ...Array.from({ length: 12 }, (_, k) => meta({ generator: "pesante", entities: [`tm:p:${20 + k}`] })),
    ];
    for (let seed = 1; seed < 60; seed++) {
      const people = new Set<string>();
      const picked = sampleVaried(items, 4, new Rng(seed), new Set(), people)!;
      const subjects = picked.map((p) => p.entities[0]);
      expect(new Set(subjects).size).toBe(4);
      expect(people.size).toBe(4);
      expect(sampleVaried(items, 4, new Rng(seed), new Set(), new Set(["tm:p:1"]))!.some((p) => p.entities[0] === "tm:p:1")).toBe(false);
    }
    // a list names many people and is about none of them
    expect(subjectsOf(meta({ entities: ["tm:p:1", "tm:p:2", "tm:p:3"] }))).toEqual([]);
    // the device history is soft: with nobody else left, the rested people come back
    const packs = makePacks();
    const all = packs.items.maglia.flatMap((m) => (m as { entities: string[] }).entities);
    const r = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed: 5, forcedGames: ["maglia"], rounds: 3, avoidPeople: all }, packs);
    expect(r.ok).toBe(true);
    const rested = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed: 5, forcedGames: ["maglia"], rounds: 3, avoidPeople: all.slice(0, 10) }, packs);
    if (!rested.ok) throw new Error(rested.reason);
    expect(rested.state.content.flat().some((m) => (m as { entities: string[] }).entities.some((e) => all.slice(0, 10).includes(e)))).toBe(false);
  });
  it("draws about four transfers in five above 20 million (SPEC §4.3)", () => {
    const items = [
      ...Array.from({ length: 300 }, (_, k) => meta({ generator: "mercato", entities: [`tm:p:${k}`] })),
      ...Array.from({ length: 300 }, (_, k) => meta({ generator: k % 2 ? "mercato_minore" : "mercato_minore@x", entities: [`tm:p:${1000 + k}`] })),
    ];
    let big = 0;
    let all = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const picked = sampleVaried(items, 4, new Rng(seed), new Set())!;
      expect(new Set(picked.map((p) => p.entities[0])).size).toBe(4);
      big += picked.filter((p) => p.generator === "mercato").length;
      all += picked.length;
    }
    expect(big / all).toBeGreaterThan(0.73);
    expect(big / all).toBeLessThan(0.83);
    // with no cheap transfer left (e.g. a narrow league filter), the big ones still fill the game
    expect(sampleVaried(items.slice(0, 300), 6, new Rng(1), new Set())!.length).toBe(6);
  });
  it("respects draw constraints", () => {
    for (let seed = 1; seed < 200; seed++) {
      const d = drawGames(new Rng(seed), POOL);
      expect(new Set(d).size).toBe(5);
      expect(d.filter((g) => g === "mercato" || g === "giramondo").length).toBeLessThanOrEqual(1);
      expect(d.filter((g) => ["decina", "dischetto", "asta"].includes(g)).length).toBeLessThanOrEqual(2);
      expect(d.includes("decina") && d.includes("asta")).toBe(false); // the two games on the same kind of set never meet
      expect(["tiro_secco", "maglia"]).toContain(d[0]);
    }
  });
  it("does not always draw the same five games", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 200; seed++) seen.add([...drawGames(new Rng(seed), POOL)].sort().join());
    expect(seen.size).toBeGreaterThan(6);
    const all = new Set(Array.from({ length: 200 }, (_, k) => drawGames(new Rng(k + 1), POOL)).flat());
    expect(all.size).toBe(12); // every game comes out sooner or later
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
    const r = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed: 1, leagues: ["GB1"], forcedGames: ["tiro_secco", "maglia", "formazione", "decina", "dischetto"] }, p);
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
  it("tiro secco: every wrong option is wrong, and only the right one scores", () => {
    for (const choice of [0, 1, 2, 3]) {
      const s0 = start(first("tiro_secco"));
      const s1 = run(s0, { type: "ANSWER", payload: { choice } });
      expect(s1.game!.last!.ok, `option ${choice}`).toBe(choice === 1);
      expect(s1.game!.last!.points, `option ${choice}`).toBe(choice === 1 ? 2 : 0);
      expect(s1.game!.last!.said, `option ${choice}`).toBe(choice === 1 ? undefined : s0.game!.items[0].options[choice]);
    }
    // an answer that is not one of the four options is ignored, never judged
    const s0 = start(first("tiro_secco"));
    for (const choice of [-1, 4, 1.5, Number.NaN]) expect(run(s0, { type: "ANSWER", payload: { choice } }).game!.last).toBeNull();
  });
});

describe("grace period: ten more seconds to finish typing (SPEC §3.8)", () => {
  it("a typed answer survives the end of the countdown and is still judged", () => {
    let s = start(first("decina"));
    const turn = s.game!.turn;
    const before = s.timer!;
    s = expire(s);
    expect(s.timer).toMatchObject({ grace: true, ms: 10_000, kind: before.kind });
    expect(s.timer!.id).not.toBe(before.id);
    expect(s.events).toEqual([{ type: "grace" }]);
    expect(s.game!.stage).toBe("ask"); // nothing was judged yet
    expect(s.game!.errors).toEqual([0, 0]);
    s = run(s, { type: "ANSWER", payload: { text: P(0).name } });
    expect(s.game!.last).toMatchObject({ ok: true, player: turn });
    expect(s.scores[turn]).toBe(2);
  });
  it("when the grace period runs out too, the answer is lost", () => {
    let s = expire(start(first("decina")));
    const turn = s.game!.turn;
    s = expire(s);
    expect(s.game!.errors[turn]).toBe(1);
    expect(s.game!.stage).toBe("feedback");
    expect(s.timer?.grace).toBeUndefined(); // the pause after the answer is not a grace period
  });
  it("an old countdown cannot fire during the grace period", () => {
    const s0 = start(first("decina"));
    const s1 = expire(s0);
    expect(reduce(s1, { type: "TIMEOUT", timerId: s0.timer!.id }, ctx)).toBe(s1);
  });
  it("applies to every typed answer: penalties, buzzer answers, line-ups, auctions", () => {
    let s = expire(start(first("dischetto")));
    expect(s.timer?.grace).toBe(true);
    s = start(first("mercato"));
    s = expire(s); // "PRONTI…"
    expect(s.timer?.grace).toBeUndefined();
    s = expire(s); // a clue comes out by itself: nothing to type
    expect(s.timer?.grace).toBeUndefined();
    s = run(s, { type: "BUZZ", player: 0 });
    s = expire(s);
    expect(s.timer).toMatchObject({ grace: true, kind: "answer" });
    expect(s.game!.stage).toBe("answering");
    s = run(s, { type: "ANSWER", player: 0, payload: { text: s.game!.items[0].answer.display } });
    expect(s.game!.winner).toBe(0);
    s = run(start(first("formazione")), { type: "CHOOSE", value: 0 });
    expect(expire(s).timer?.grace).toBe(true);
    s = start(first("asta"));
    const a = s.game!.turn;
    s = run(s, { type: "BID", player: a, amount: 3 }, { type: "PASS", player: 1 - a } as Intent);
    expect(expire(s).timer?.grace).toBe(true);
  });
  it("does not apply to multiple choice, to the number pad, or when a host judges spoken answers", () => {
    let s = expire(start(g5));
    expect(s.timer).toBeNull();
    expect(s.game!.stage).toBe("reveal");
    s = expire(start(first("maglia")));
    expect(s.game!.stage).toBe("reveal");
    s = expire(start(first("decina"), { judging: "host" }));
    expect(s.game!.stage).toBe("feedback");
  });
});

describe("timer off (SPEC §3.8)", () => {
  const off = (games: GameId[]) => start(games, { timer: false });
  it("no countdown while a player thinks", () => {
    expect(off(g5).timer).toBeNull();
    expect(off(first("maglia")).timer).toBeNull();
    expect(off(first("decina")).timer).toBeNull();
    const s = run(off(first("formazione")), { type: "CHOOSE", value: 0 });
    expect(s.timer).toBeNull();
    expect(start(g5).timer).not.toBeNull(); // on by default
  });
  it("the short pauses of the show stay", () => {
    let s = off(first("mercato"));
    expect(s.timer).toMatchObject({ kind: "ready" });
    s = off(first("decina"));
    s = run(s, { type: "ANSWER", payload: { text: P(0).name } });
    expect(s.timer).toMatchObject({ kind: "feedback" });
  });
  it("mercato and giramondo: the clues come out by hand and the points go down", () => {
    for (const game of ["mercato", "giramondo"] as const) {
      let s = expire(off(first(game))); // "PRONTI…" is over: first clue
      expect(s.game!.revealed).toBe(1);
      expect(s.timer).toBeNull();
      s = run(s, { type: "REVEAL_CLUE" }, { type: "REVEAL_CLUE" });
      expect(s.game!.revealed).toBe(3);
      expect(s.timer).toBeNull();
      const target = s.game!.items[0].answer.display as string;
      s = run(s, { type: "BUZZ", player: 1 });
      expect(s.timer).toBeNull(); // no rush to answer either
      s = run(s, { type: "ANSWER", player: 1, payload: { text: target } });
      expect(s.scores[1]).toBe(s.game!.points[2]);
    }
  });
  it("with every clue out, one more press closes the profile", () => {
    let s = expire(off(first("mercato")));
    for (let k = 0; k < 5; k++) s = run(s, { type: "REVEAL_CLUE" });
    expect(s.game!.revealed).toBe(6);
    expect(s.game!.stage).toBe("clues");
    s = run(s, { type: "REVEAL_CLUE" });
    expect(s.game!.stage).toBe("reveal");
  });
  it("with the timer on the clues still come out by themselves, not by hand", () => {
    const s = expire(start(first("mercato")));
    expect(run(s, { type: "REVEAL_CLUE" }).game!.revealed).toBe(1);
  });
  it("the player on turn may pass; nobody else, and never with the timer on", () => {
    let s = off(first("decina"));
    const turn = s.game!.turn;
    expect(reduce(s, { type: "SKIP", player: turn === 0 ? 1 : 0 }, ctx)).toBe(s);
    s = run(s, { type: "SKIP", player: turn });
    expect(s.game!.errors[turn]).toBe(1);
    const on = start(first("decina"));
    expect(reduce(on, { type: "SKIP", player: on.game!.turn }, ctx)).toBe(on);
    // a buzzer who does not know gives up the answer
    s = run(expire(off(first("mercato"))), { type: "BUZZ", player: 0 }, { type: "SKIP", player: 0 });
    expect(s.game!.out[0]).toBe(true);
  });
  it("a whole match can be played to the end without a single countdown", () => {
    let s = off(g5);
    let guard = 0;
    while (s.phase !== "match_over" && guard++ < 500) {
      if (s.phase === "intro") s = run(s, { type: "BEGIN_GAME" });
      else if (s.timer) {
        expect(["ready", "feedback"]).toContain(s.timer.kind);
        s = expire(s);
      } else if (s.game?.stage === "choose") s = run(s, { type: "CHOOSE", value: 0 });
      else if (s.game?.stage === "ask") s = s.game.game === "tiro_secco" ? run(s, { type: "ANSWER", payload: { choice: 0 } }) : run(s, { type: "SKIP" });
      else if (s.game?.stage === "play") s = run(s, { type: "FINISH" });
      else s = run(s, { type: "NEXT" });
    }
    expect(s.phase).toBe("match_over");
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

describe("testa a testa: a duel on one chain (SPEC §4.11)", () => {
  // the fixture chain goes 10, 20, 5, 30, 15, 40, 25: MORE, LESS, MORE, LESS, MORE, LESS
  const RIGHT = [1, 0, 1, 0, 1, 0];
  const say = (s: MatchState, choice: number) => run(s, { type: "ANSWER", player: s.game!.turn, payload: { choice } } as Intent);
  /** The pause that shows the value that came out. */
  const pause = (s: MatchState) => expire(s);
  it("is one chain per game, and it alternates: right +1, the chain passes to the opponent", () => {
    expect(itemsNeeded("testa_a_testa")).toBe(1);
    let s = start(first("testa_a_testa"));
    const a = s.game!.turn as 0 | 1;
    s = say(s, 1);
    expect(s.scores[a]).toBe(1);
    expect(s.game!.stage).toBe("feedback");
    s = pause(s);
    expect(s.game!.turn).toBe(a === 0 ? 1 : 0);
    expect(s.game!.k).toBe(2);
  });
  it("the first mistake ends the duel: +3 to the opponent", () => {
    let s = start(first("testa_a_testa"));
    const a = s.game!.turn as 0 | 1;
    const b = a === 0 ? 1 : 0;
    s = pause(say(s, 1)); // a: right
    s = say(s, 1); // b: wrong (20 -> 5 is LESS)
    expect(s.scores[a]).toBe(1 + 3);
    expect(s.scores[b]).toBe(0);
    expect(s.game!.stage).toBe("reveal");
    expect(s.game!.last).toMatchObject({ ok: false, said: "PIÙ", winner: a });
  });
  it("a chain guessed to the end is a draw: one point per guess, no duel bonus", () => {
    let s = start(first("testa_a_testa"));
    RIGHT.forEach((c, j) => {
      s = say(s, c);
      if (j < RIGHT.length - 1) s = pause(s);
    });
    expect(s.scores[0] + s.scores[1]).toBe(6);
    expect(s.scores[0]).toBe(3);
    expect(s.game!.stage).toBe("reveal");
  });
  it("at most 3 + 3 points for a player in a game: it weighs like the other games", () => {
    // best case for one player: all his guesses right, the opponent wrong on the last step
    let s = start(first("testa_a_testa"));
    const a = s.game!.turn as 0 | 1;
    RIGHT.slice(0, 5).forEach((c) => (s = pause(say(s, c))));
    s = say(s, 1 - RIGHT[5]!); // the opponent misses the last one
    expect(s.scores[a]).toBe(3 + 3);
  });
  it("out of time counts as a mistake", () => {
    let s = start(first("testa_a_testa"));
    const a = s.game!.turn as 0 | 1;
    s = timeout(s);
    expect(s.scores[a === 0 ? 1 : 0]).toBe(3);
    expect(s.game!.stage).toBe("reveal");
  });
  it("only the player on turn answers", () => {
    let s = start(first("testa_a_testa"));
    const other = s.game!.turn === 0 ? 1 : 0;
    s = run(s, { type: "ANSWER", player: other, payload: { choice: 1 } });
    expect(s.game!.stage).toBe("guess");
  });
  it("never shows the Screen or the phones a value before it is compared", () => {
    let s = start(first("testa_a_testa"));
    for (const role of ["screen", "p1", "p2"] as const) {
      const chain = viewFor(s, role).game!.items[0].chain;
      expect(chain[0].value).toBe(10);
      expect(chain[1]).toMatchObject({ value: null, label: null });
      expect(chain[1].name).not.toBe("");
      expect(chain.slice(2).every((c: { name: string; value: null }) => c.name === "" && c.value === null)).toBe(true);
    }
    expect(viewFor(s, "host").game!.items[0].chain[3].value).toBe(30);
    s = say(s, 1);
    expect(viewFor(s, "screen").game!.items[0].chain[1].value).toBe(20);
    expect(viewFor(s, "screen").game!.items[0].chain[2].value).toBeNull();
  });
  it("alone (Allenamento): a point per guess until the first mistake, nobody to give the duel to", () => {
    const r = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed: 3, forcedGames: ["testa_a_testa"], solo: true }, packs);
    if (!r.ok) throw new Error(r.reason);
    let s = run(r.state, { type: "START" }, { type: "BEGIN_GAME" });
    s = pause(say(s, 1));
    expect(s.game!.turn).toBe(0);
    s = say(s, 1); // wrong
    expect(s.scores).toEqual([1, 0]);
  });
  it("works with the timer off: no countdown, the buttons move it on", () => {
    let s = start(first("testa_a_testa"), { timer: false });
    expect(s.timer).toBeNull();
    s = say(s, 1);
    expect(s.timer?.kind).toBe("feedback"); // the short pause still shows the value
    s = pause(s);
    expect(s.timer).toBeNull();
  });
  it("sfida rapida: three chains, one per round", () => {
    expect(singleGamePlan("testa_a_testa", { rounds: 3 })).toEqual({ order: ["testa_a_testa", "testa_a_testa", "testa_a_testa"], need: 1 });
  });
});

describe("indovina lo stemma (SPEC §4.15)", () => {
  it("before the reveal the Screen and the phones see only the transformed crest", () => {
    let s = start(first("stemma"));
    for (const role of ["screen", "p1", "p2"] as const) {
      const it = viewFor(s, role).game!.items[0];
      expect(it.correct).toBe(-1);
      expect(it.original).toBe("");
      expect(it.team).toBe("");
      expect(it.credit).toBe("");
      expect(it.options).toHaveLength(4);
      expect(it.image ?? it.colors).toBeTruthy();
      expect(viewFor(s, role).game!.items[1]).toBeNull(); // the next crest is not sent at all
    }
    const p = s.game!.turn as 0 | 1;
    s = run(s, { type: "ANSWER", player: p, payload: { choice: 0 } });
    expect(s.scores[p]).toBe(2);
    const shown = viewFor(s, "screen").game!.items[0];
    expect(shown.original).toMatch(/^crests\//);
    expect(shown.team).toMatch(/^Club /);
  });
  it("four crests of four different clubs, in different variants", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = start(first("stemma"), { seed });
      const items = s.game!.items as { entities: string[]; variant: string }[];
      expect(new Set(items.map((x) => x.entities.find((e) => e.startsWith("tm:c:")))).size).toBe(4);
      expect(new Set(items.map((x) => x.variant)).size).toBe(4);
    }
  });
});

describe("games chosen by the players (SPEC §5.4)", () => {
  const five: GameId[] = ["stemma", "maglia", "figurina", "decina", "tiro_secco"];
  it("chosen by hand: those five games, in that order; the coin still says who starts", () => {
    const r = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed: 3, forcedGames: five, pick: "manual" }, packs);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.order).toEqual(five);
  });
  it("draft: the player who chose second starts the match, whatever the seed", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const starter of [0, 1] as const) {
        const r = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed, forcedGames: five, pick: "draft", pickedBy: [1 - starter, starter, 1 - starter, starter, 1 - starter] as (0 | 1)[], starter }, packs);
        if (!r.ok) throw new Error(r.reason);
        let s = reduce(r.state, { type: "START" }, ctx);
        s = reduce(s, { type: "BEGIN_GAME" }, ctx);
        expect(s.coin).toBe(starter);
        expect(s.starters[0]).toBe(starter);
      }
    }
  });
  it("a chosen game is played once, and only if it has questions for the filters", () => {
    const twice = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed: 3, forcedGames: ["maglia", "maglia", "decina", "stemma", "tiro_secco"], pick: "manual" }, packs);
    expect(twice.ok).toBe(false);
    const empty = makePacks();
    empty.items.stemma = [];
    const none = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed: 3, forcedGames: five, pick: "draft", starter: 1 }, empty);
    expect(none.ok === false && none.reason).toMatch(/stemma/);
  });
});

describe("indovina la figurina (SPEC §4.16)", () => {
  it("the photo sharpens one frame per clue; name, real photo and credit only at the reveal", () => {
    let s = start(first("figurina"));
    expect(s.game!.items).toHaveLength(2);
    s = timeout(s); // PRONTI… -> first clue
    for (const role of ["screen", "p1", "p2"] as const) {
      const it = viewFor(s, role).game!.items[0];
      expect(it.clues).toHaveLength(1);
      expect(it.frames).toHaveLength(1);
      expect(it.flag).toBeNull(); // the flag comes with the nationality clue
      expect(it.card).toBeNull();
      expect(it.answer.display).toBe("");
      expect(it.sources).toEqual([]);
      expect(it.entities).toEqual([]);
      expect(JSON.stringify(viewFor(s, role).game)).not.toContain("Mario");
      expect(viewFor(s, role).game!.items[1]).toBeNull();
    }
    s = timeout(s);
    const two = viewFor(s, "screen").game!.items[0];
    expect(two.frames).toEqual(s.game!.items[0].frames.slice(0, 2));
    expect(two.flag).toBe("it");
    const target = s.game!.items[0].answer.display as string;
    s = run(s, { type: "BUZZ", player: 1 }, { type: "ANSWER", player: 1, payload: { text: target } });
    expect(s.scores).toEqual([0, 9]); // second clue: 9 points
    const shown = viewFor(s, "p1").game!.items[0];
    expect(shown.card.name).toBe(target);
    expect(shown.card.photo).toMatch(/^photos\//);
  });
  it("a «who is it?» buzzer game at most once per match", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = createMatch({ judging: "auto", players: ["A", "B"], yearFrom: null, seed }, packs);
      if (!r.ok) throw new Error(r.reason);
      expect(r.state.order.filter((g) => ["mercato", "giramondo", "figurina"].includes(g)).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("no answer through the references (invariant 5)", () => {
  it("sources and entities reach the Screen and the phones only with the reveal", () => {
    for (const g of ["tiro_secco", "mercato", "giramondo", "maglia", "stemma", "figurina"] as GameId[]) {
      let s = start(first(g));
      if (s.game!.stage === "ready") s = timeout(s);
      for (const role of ["screen", "p1", "p2"] as const) {
        const it = viewFor(s, role).game!.items.find((x: unknown) => x !== null);
        expect(it.sources, g).toEqual([]);
        expect(it.entities, g).toEqual([]);
      }
    }
  });
});

describe("le bandiere (SPEC §4.14)", () => {
  it("shows the flags for exactly 5 seconds, then the question; the team only at the reveal", () => {
    let s = start(first("bandiere"));
    expect(s.game!.stage).toBe("memo");
    expect(s.timer).toMatchObject({ kind: "memo", ms: 5000 });
    const memo = viewFor(s, "screen").game!.items[0];
    expect(memo.players.every((p: { flag: string; name: string }) => p.flag && !p.name)).toBe(true);
    expect(memo.team).toBe("");
    expect(memo.options).toEqual([]);
    expect(run(s, { type: "ANSWER", player: s.game!.turn, payload: { choice: 0 } }).game!.stage).toBe("memo"); // no answer before
    s = expire(s);
    expect(s.game!.stage).toBe("ask");
    const ask = viewFor(s, "p2").game!.items[0];
    expect(ask.players.every((p: { flag: string }) => p.flag === "")).toBe(true);
    expect(ask.options).toHaveLength(4);
    expect(ask.correct).toBe(-1);
    const p = s.game!.turn as 0 | 1;
    s = run(s, { type: "ANSWER", player: p, payload: { choice: 0 } });
    expect(s.scores[p]).toBe(2);
    const shown = viewFor(s, "screen").game!.items[0];
    expect(shown.team).toBe("Juventus");
    expect(shown.players[0].name).not.toBe("");
  });
  it("the 5 seconds run with the countdowns switched off too", () => {
    let s = start(first("bandiere"), { timer: false });
    expect(s.timer).toMatchObject({ kind: "memo", ms: 5000 });
    s = expire(s);
    expect(s.game!.stage).toBe("ask");
    expect(s.timer).toBeNull(); // the answer itself has no countdown
  });
  it("two line-ups each, in turn", () => {
    let s = start(first("bandiere"));
    const a = s.game!.turn;
    s = run(expire(s), { type: "ANSWER", player: a, payload: { choice: 1 } }, { type: "NEXT" });
    expect(s.game!.turn).not.toBe(a);
    expect(s.game!.stage).toBe("memo");
  });
});

describe("tiro secco: trasferimento vero o falso (SPEC §4.1, v14)", () => {
  it("two options are enough, and a third one is ignored", () => {
    const vf = { ...meta({ generator: "ts_vero_falso" }), question: "VF", options: ["VERO", "FALSO"], correct: 1, archetype: 5, tag: "vf",
      transfer: { player: "Mario Abete", from: "A", to: "B", season: "2018/19" } };
    let s = start(first("tiro_secco"));
    // force the first question to be the true-or-false one
    s.game!.items[0] = vf;
    const p = s.game!.turn as 0 | 1;
    expect(run(s, { type: "ANSWER", player: p, payload: { choice: 2 } }).game!.stage).toBe("ask");
    s = run(s, { type: "ANSWER", player: p, payload: { choice: (vf as { correct: number }).correct } });
    expect(s.scores[p]).toBe(2);
  });
});

describe("tiro secco: famiglie di domande (SPEC §4.1, v15)", () => {
  const tagged = (tag: string | undefined, gens: number, per: number, from: number) =>
    Array.from({ length: gens * per }, (_, k) => ({ ...meta({ generator: `${tag ?? "quiz"}_${k % gens}`, entities: [`tm:p:${from + k}`] }), tag }));
  // a curiosity family with many generators and many questions, and five smaller families
  const items = [
    ...tagged(undefined, 35, 40, 0),
    ...tagged("record", 28, 10, 5000),
    ...tagged("nomi", 8, 10, 6000),
    ...tagged("vf", 2, 500, 7000),
    ...tagged("scheda", 2, 200, 9000),
    ...tagged("campioni", 20, 50, 10000),
    ...tagged("confronto", 6, 60, 12000),
  ];
  const fam = FAMILY_OF.tiro_secco!;
  it("the four questions of a match come from four different families", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const picked = sampleVaried(items, 4, new Rng(seed), new Set(), new Set(), fam)!;
      expect(new Set(picked.map(fam)).size).toBe(4);
    }
  });
  it("every family comes out about as often, however many generators or questions it has", () => {
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= 700; seed++) for (const it of sampleVaried(items, 4, new Rng(seed), new Set(), new Set(), fam)!) seen.set(fam(it), (seen.get(fam(it)) ?? 0) + 1);
    for (const f of ["curiosita", "record", "nomi", "vf", "scheda", "campioni", "confronto"]) {
      expect(seen.get(f)! / 2800).toBeGreaterThan(0.1);
      expect(seen.get(f)! / 2800).toBeLessThan(0.19);
    }
  });
  it("with fewer families than questions, families repeat instead of failing", () => {
    const two = [...tagged("vf", 2, 20, 0), ...tagged("scheda", 2, 20, 100)];
    expect(sampleVaried(two, 4, new Rng(5), new Set(), new Set(), fam)).toHaveLength(4);
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

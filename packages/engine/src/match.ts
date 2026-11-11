import {
  GAME_IDS,
  type CassaforteItem,
  type GameId,
  type InstanceMeta,
  type Packs,
  type PlayerIdx,
  type PoolGameId,
  type Role,
} from "@trivela/protocol";
import { MODULES } from "./games";
import { Rng } from "./rng";
import { parseTopic, rankByTopic } from "./topic";
import {
  other,
  type EngineCtx,
  type EngineEvent,
  type Env,
  type Intent,
  type MatchConfig,
  type MatchState,
  type TopicResolution,
} from "./types";

export const POOL: PoolGameId[] = GAME_IDS.filter((g): g is PoolGameId => g !== "cassaforte");

/* ------------------------------------------------------------------ */
/* Year filter (SPEC §3.3)                                              */
/* ------------------------------------------------------------------ */

const EVENT_GAMES: GameId[] = ["tiro_secco", "mercato", "formazione", "frame", "mappamondo", "maglia"];
const PERSON_GAMES: GameId[] = ["giramondo", "filo_rosso", "intruso"];

export function passesYearFilter(game: GameId, item: InstanceMeta, yearFrom: number | null): boolean {
  if (yearFrom === null) return true;
  if (EVENT_GAMES.includes(game)) return item.yearMin >= yearFrom;
  if (PERSON_GAMES.includes(game)) return (item.activeYears ?? [item.yearMax]).every((y) => y >= yearFrom);
  return true; // lists (decina, dischetto, asta) and free-topic games ignore the filter
}

export function eligibleItems(game: GameId, packs: Packs, config: MatchConfig): InstanceMeta[] {
  const exclude = new Set(config.excludeIds ?? []);
  return (packs.items[game] as InstanceMeta[]).filter(
    (it) => !exclude.has(it.id) && passesYearFilter(game, it, config.yearFrom),
  );
}

/* ------------------------------------------------------------------ */
/* Draw (SPEC §5.2)                                                     */
/* ------------------------------------------------------------------ */

const BUZZER_GROUP: PoolGameId[] = ["mercato", "giramondo"];
const LIST_GROUP: PoolGameId[] = ["decina", "dischetto", "asta"];
const OPENERS: PoolGameId[] = ["tiro_secco", "frame", "maglia", "intruso", "mappamondo"];

export function drawGames(rng: Rng, available: PoolGameId[]): PoolGameId[] {
  const avail = new Set(available);
  const openers = OPENERS.filter((g) => avail.has(g));
  const out: PoolGameId[] = [];
  const ok = (g: PoolGameId) => {
    if (out.includes(g)) return false;
    if (BUZZER_GROUP.includes(g) && out.some((x) => BUZZER_GROUP.includes(x))) return false;
    if (LIST_GROUP.includes(g) && out.some((x) => LIST_GROUP.includes(x))) return false;
    return true;
  };
  if (openers.length) out.push(rng.pick(openers));
  for (const g of rng.shuffle([...avail])) {
    if (out.length >= 4) break;
    if (ok(g)) out.push(g);
  }
  // If constraints left us short, relax them (never repeat a game).
  for (const g of rng.shuffle([...avail])) {
    if (out.length >= 4) break;
    if (!out.includes(g)) out.push(g);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Match creation                                                       */
/* ------------------------------------------------------------------ */

export type CreateResult = { ok: true; state: MatchState } | { ok: false; reason: string };

export function resolveTopics(config: MatchConfig, ctx: EngineCtx): [TopicResolution, TopicResolution] {
  return [parseTopic(config.topics[0], ctx.index), parseTopic(config.topics[1], ctx.index)];
}

export function createMatch(config: MatchConfig, packs: Packs, ctx: EngineCtx): CreateResult {
  const rng = new Rng(config.seed);
  const topics = resolveTopics(config, ctx);
  for (const [i, t] of topics.entries()) {
    if (t.status === "unknown") {
      return { ok: false, reason: `Argomento di ${config.players[i]} non riconosciuto: riscrivilo.` };
    }
  }
  const content: Partial<Record<GameId, unknown[]>> = {};
  const used = new Set<string>();
  const take = (game: GameId, list: InstanceMeta[], n: number) => {
    const picked: InstanceMeta[] = [];
    for (const it of list) {
      if (picked.length >= n) break;
      if (used.has(it.id)) continue;
      used.add(it.id);
      picked.push(it);
    }
    return picked.length === n ? picked : null;
  };

  const selectTopicItems = (game: GameId): unknown[] | null => {
    const pool = eligibleItems(game, packs, config);
    const perPlayer: unknown[] = [];
    for (const p of [0, 1] as const) {
      const ranked = rankByTopic(pool, topics[p], packs.topics, (a) => rng.shuffle(a));
      if (game === "cassaforte") {
        const levels: CassaforteItem[] = [];
        for (const level of [1, 2, 3] as const) {
          const hit = ranked.candidates.find(
            (it) => (it as CassaforteItem).level === level && !used.has(it.id),
          ) as CassaforteItem | undefined;
          if (!hit) return null;
          used.add(hit.id);
          levels.push(hit);
          if (ranked.levels[ranked.candidates.indexOf(hit)]! >= 3) topics[p].status = "broadened";
        }
        perPlayer.push(levels);
      } else {
        const hit = ranked.candidates.find((it) => !used.has(it.id));
        if (!hit) return null;
        used.add(hit.id);
        if (ranked.levels[ranked.candidates.indexOf(hit)]! >= 3) topics[p].status = "broadened";
        perPlayer.push(hit);
      }
    }
    return perPlayer;
  };

  const available = POOL.filter((g) => {
    if (g === "prima_pagina") return eligibleItems(g, packs, config).length >= 2;
    return eligibleItems(g, packs, config).length >= MODULES[g].count;
  });
  const games = config.forcedGames ?? drawGames(rng, available);
  if (games.length < 4) return { ok: false, reason: "Contenuti insufficienti per sorteggiare 4 giochi." };

  for (const g of games) {
    if (g === "prima_pagina") {
      const items = selectTopicItems(g);
      if (!items) return { ok: false, reason: "Contenuti insufficienti per Prima Pagina." };
      content[g] = items;
      continue;
    }
    const items = take(g, rng.shuffle(eligibleItems(g, packs, config)), MODULES[g].count);
    if (!items) return { ok: false, reason: `Contenuti insufficienti per ${g}.` };
    content[g] = items;
  }
  const cassa = selectTopicItems("cassaforte");
  if (!cassa) return { ok: false, reason: "Contenuti insufficienti per la Cassaforte." };
  content.cassaforte = cassa;

  const order: GameId[] = [...games, "cassaforte"];
  const state: MatchState = {
    config,
    scores: [0, 0],
    order,
    gameIdx: 0,
    phase: "draw",
    starters: [],
    gamePoints: order.map(() => [0, 0] as [number, number]),
    game: null,
    content,
    topics,
    timer: null,
    timerSeq: 0,
    events: [],
    coin: rng.int(2) as PlayerIdx,
  };
  return { ok: true, state };
}

/* ------------------------------------------------------------------ */
/* Reducer                                                              */
/* ------------------------------------------------------------------ */

function starterFor(s: MatchState): PlayerIdx {
  if (s.gameIdx === 0) return s.coin;
  const [a, b] = s.scores;
  if (a < b) return 0;
  if (b < a) return 1;
  return other(s.starters[s.gameIdx - 1] ?? s.coin);
}

function makeEnv(s: MatchState, ctx: EngineCtx, events: EngineEvent[]): Env {
  return {
    ctx,
    judging: s.config.judging,
    starter: s.starters[s.gameIdx] ?? s.coin,
    addPoints(player, points) {
      s.scores[player] += points;
      s.gamePoints[s.gameIdx]![player] += points;
    },
    emit(e) {
      events.push(e);
    },
    setTimer(ms, kind) {
      s.timerSeq += 1;
      s.timer = { id: s.timerSeq, ms, kind };
    },
    clearTimer() {
      s.timer = null;
    },
    timerId: () => s.timer?.id ?? null,
    timerKind: () => s.timer?.kind ?? null,
  };
}

export function reduce(prev: MatchState, intent: Intent, ctx: EngineCtx): MatchState {
  if (intent.type === "TIMEOUT" && prev.timer?.id !== intent.timerId) return prev;
  const s = structuredClone(prev);
  const events: EngineEvent[] = [];
  s.events = events;
  if (intent.type === "TIMEOUT") s.timer = null;

  switch (s.phase) {
    case "draw":
      if (intent.type === "START") {
        s.phase = "intro";
        s.starters[0] = starterFor(s);
      }
      break;
    case "intro":
      if (intent.type === "BEGIN_GAME") {
        const g = s.order[s.gameIdx]!;
        const env = makeEnv(s, ctx, events);
        s.game = MODULES[g].init(s.content[g] ?? [], env);
        s.phase = "playing";
        events.push({ type: "game_start", game: g });
      }
      break;
    case "playing": {
      const g = s.order[s.gameIdx]!;
      const mod = MODULES[g];
      const env = makeEnv(s, ctx, events);
      mod.reduce(s.game!, intent, env);
      if (mod.done(s.game!)) {
        s.phase = "game_over";
        s.timer = null;
        events.push({ type: "game_end", game: g });
      }
      break;
    }
    case "game_over":
      if (intent.type === "NEXT") {
        s.gameIdx += 1;
        s.game = null;
        if (s.gameIdx >= s.order.length) {
          s.phase = "match_over";
          const [a, b] = s.scores;
          events.push({ type: "match_over", winner: a === b ? null : a > b ? 0 : 1 });
        } else {
          s.phase = "intro";
          s.starters[s.gameIdx] = starterFor(s);
        }
      }
      break;
    case "match_over":
      break;
  }
  return s;
}

/** Role-filtered view: only the host sees answers before they are revealed. */
export function viewFor(s: MatchState, role: Role): MatchState {
  if (role === "host") return s;
  const v: MatchState = { ...s, content: {} };
  if (s.game) v.game = MODULES[s.game.game].redact(s.game, role);
  return v;
}

export function winnerOf(s: MatchState): PlayerIdx | null {
  const [a, b] = s.scores;
  return a === b ? null : a > b ? 0 : 1;
}

/** Instance ids used in a match (for tournament dedup and device history). */
export function usedIds(s: MatchState): string[] {
  const ids: string[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object" && "id" in x && "generator" in x) ids.push((x as InstanceMeta).id);
  };
  Object.values(s.content).forEach(walk);
  return ids;
}

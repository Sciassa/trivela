import { GAME_IDS, leaguesOf, type GameId, type InstanceMeta, type Packs, type PlayerIdx, type Role } from "@trivela/protocol";
import { MODULES } from "./games";
import { Rng } from "./rng";
import { other, type EngineCtx, type EngineEvent, type Env, type Intent, type MatchConfig, type MatchState } from "./types";

export const POOL: GameId[] = [...GAME_IDS];
/** Games drawn for every match. */
export const GAMES_PER_MATCH = 5;

/* ------------------------------------------------------------------ */
/* Year filter (SPEC §3.3)                                              */
/* ------------------------------------------------------------------ */

const EVENT_GAMES: GameId[] = ["tiro_secco", "anomalia", "mercato", "formazione", "maglia"];
const PERSON_GAMES: GameId[] = ["giramondo"];

export function passesYearFilter(game: GameId, item: InstanceMeta, yearFrom: number | null): boolean {
  if (yearFrom === null) return true;
  if (EVENT_GAMES.includes(game)) return item.yearMin >= yearFrom;
  if (PERSON_GAMES.includes(game)) return (item.activeYears ?? [item.yearMax]).every((y) => y >= yearFrom);
  return true; // lists and rankings (decina, dischetto, asta) ignore the filter
}

/**
 * League filter (SPEC §3.4): an instance tied to domestic leagues needs at
 * least one of them to be selected; national teams and big tournaments carry no
 * league and are always eligible.
 */
export function passesLeagueFilter(item: InstanceMeta, leagues: string[] | null | undefined): boolean {
  if (!leagues) return true;
  const own = leaguesOf(item);
  return own.length === 0 || own.some((l) => leagues.includes(l));
}

export function eligibleItems(game: GameId, packs: Packs, config: MatchConfig): InstanceMeta[] {
  const exclude = new Set(config.excludeIds ?? []);
  return (packs.items[game] as InstanceMeta[]).filter(
    (it) => !exclude.has(it.id) && passesYearFilter(game, it, config.yearFrom) && passesLeagueFilter(it, config.leagues),
  );
}

/** How many instances a game consumes in one match. */
export function itemsNeeded(game: GameId): number {
  const m = MODULES[game];
  return m.perPlayer ? m.count * 2 : m.count;
}

/** Games made of one list: a longer format plays them again, with a new list, instead of asking more questions. */
const LIST_GAMES: GameId[] = ["decina", "dischetto", "formazione"];

/** Questions of a solo session (Allenamento) when the game is made of questions or profiles. */
const SOLO_ITEMS: Partial<Record<GameId, number>> = { mercato: 4, giramondo: 4, asta: 3 };

/**
 * Slots of a single-game format: which game is played, how many times, with how many instances each time.
 * Sfida Rapida: `rounds` rounds each (two instances per round, or one list per round); Allenamento: one session.
 */
export function singleGamePlan(game: GameId, config: Pick<MatchConfig, "rounds" | "solo">): { order: GameId[]; need: number } {
  const rounds = Math.max(1, Math.floor(config.rounds ?? 3));
  if (LIST_GAMES.includes(game)) return { order: Array<GameId>(config.solo ? 1 : rounds).fill(game), need: 1 };
  return { order: [game], need: config.solo ? SOLO_ITEMS[game] ?? 6 : rounds * 2 };
}

const isSingleGame = (c: Pick<MatchConfig, "rounds" | "solo">) => c.rounds !== undefined || c.solo === true;

/* ------------------------------------------------------------------ */
/* Draw                                                                 */
/* ------------------------------------------------------------------ */

const BUZZER_GROUP: GameId[] = ["mercato", "giramondo"];
const LIST_GROUP: GameId[] = ["decina", "dischetto", "asta"];
const OPENERS: GameId[] = ["tiro_secco", "anomalia", "maglia"];

export function drawGames(rng: Rng, available: GameId[], n = GAMES_PER_MATCH): GameId[] {
  const avail = new Set(available);
  const openers = OPENERS.filter((g) => avail.has(g));
  const out: GameId[] = [];
  const ok = (g: GameId) => {
    if (out.includes(g)) return false;
    if (BUZZER_GROUP.includes(g) && out.some((x) => BUZZER_GROUP.includes(x))) return false;
    if (LIST_GROUP.includes(g) && out.some((x) => LIST_GROUP.includes(x))) return false;
    return true;
  };
  if (openers.length) out.push(rng.pick(openers));
  for (const g of rng.shuffle([...avail])) {
    if (out.length >= n) break;
    if (ok(g)) out.push(g);
  }
  // If the constraints left us short, relax them (never repeat a game).
  for (const g of rng.shuffle([...avail])) {
    if (out.length >= n) break;
    if (!out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * Pick n items evenly across generators: question types alternate instead of
 * being proportional to how many instances each type has.
 */
export function sampleVaried<T extends InstanceMeta>(items: T[], n: number, rng: Rng, used: Set<string>): T[] | null {
  const groups = new Map<string, T[]>();
  for (const it of rng.shuffle(items)) {
    if (used.has(it.id)) continue;
    const g = groups.get(it.generator) ?? [];
    g.push(it);
    groups.set(it.generator, g);
  }
  const order = rng.shuffle([...groups.keys()]);
  const picked: T[] = [];
  while (picked.length < n && order.some((k) => groups.get(k)!.length)) {
    for (const k of order) {
      const g = groups.get(k)!;
      if (g.length && picked.length < n) picked.push(g.pop()!);
    }
  }
  if (picked.length < n) return null;
  picked.forEach((it) => used.add(it.id));
  return rng.shuffle(picked);
}

/* ------------------------------------------------------------------ */
/* Match creation                                                       */
/* ------------------------------------------------------------------ */

export type CreateResult = { ok: true; state: MatchState } | { ok: false; reason: string };

export function createMatch(config: MatchConfig, packs: Packs, _ctx?: EngineCtx): CreateResult {
  const rng = new Rng(config.seed);
  const used = new Set<string>();
  let order: GameId[];
  let needs: number[];
  if (isSingleGame(config)) {
    const game = config.forcedGames?.[0];
    if (!game) return { ok: false, reason: "Scegli un gioco." };
    const plan = singleGamePlan(game, config);
    order = plan.order;
    needs = order.map(() => plan.need);
  } else {
    const available = POOL.filter((g) => eligibleItems(g, packs, config).length >= itemsNeeded(g));
    order = config.forcedGames ?? drawGames(rng, available);
    if (order.length < GAMES_PER_MATCH && !config.forcedGames) {
      return { ok: false, reason: `Contenuti insufficienti per sorteggiare ${GAMES_PER_MATCH} giochi.` };
    }
    needs = order.map(itemsNeeded);
  }
  const content: unknown[][] = [];
  for (let k = 0; k < order.length; k++) {
    const g = order[k]!;
    const items = sampleVaried(eligibleItems(g, packs, config), needs[k]!, rng, used);
    if (!items) return { ok: false, reason: `Contenuti insufficienti per ${g}.` };
    content.push(items);
  }
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
    timer: null,
    timerSeq: 0,
    events: [],
    coin: config.solo ? 0 : (rng.int(2) as PlayerIdx),
  };
  return { ok: true, state };
}

/* ------------------------------------------------------------------ */
/* Reducer                                                              */
/* ------------------------------------------------------------------ */

function starterFor(s: MatchState): PlayerIdx {
  if (s.config.solo) return 0;
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
    solo: s.config.solo === true,
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
        s.game = MODULES[g].init(s.content[s.gameIdx] ?? [], env);
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
  const v: MatchState = { ...s, content: [] };
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
  s.content.forEach(walk);
  return ids;
}

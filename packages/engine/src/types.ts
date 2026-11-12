import type { GameId, PlayerIdx, PoolGameId, Role } from "@trivela/protocol";
import type { MatchIndex } from "@trivela/matcher";

export type Judging = "auto" | "host";

export interface MatchConfig {
  /** "host": a human host validates spoken answers (Mode A). "auto": the app judges (Mode B). */
  judging: Judging;
  players: [string, string];
  /** "Domande a partire dall'anno"; null = no filter. */
  yearFrom: number | null;
  seed: number;
  /** Instance ids that must not be used (tournament / device history). */
  excludeIds?: string[];
  /** Force the 4 drawn games (tests, debug). */
  forcedGames?: PoolGameId[];
}

export interface EngineCtx {
  index: MatchIndex;
}

export interface Timer {
  id: number;
  ms: number;
  kind: string;
}

export type EngineEvent =
  | { type: "correct"; player: PlayerIdx; points: number }
  | { type: "wrong"; player: PlayerIdx; points: number }
  | { type: "goal"; player: PlayerIdx; points: number }
  | { type: "miss"; player: PlayerIdx }
  | { type: "malus"; player: PlayerIdx; points: number }
  | { type: "clue"; index: number }
  | { type: "buzz"; player: PlayerIdx }
  | { type: "false_start"; player: PlayerIdx }
  | { type: "timeout" }
  | { type: "reveal" }
  | { type: "game_start"; game: GameId }
  | { type: "game_end"; game: GameId }
  | { type: "match_over"; winner: PlayerIdx | null }
  | { type: "notice"; text: string };

export type Intent =
  | { type: "START" }
  | { type: "BEGIN_GAME" }
  | { type: "NEXT" }
  | { type: "TIMEOUT"; timerId: number }
  | { type: "BUZZ"; player: PlayerIdx }
  | { type: "REVEAL_CLUE" }
  | { type: "CHOOSE"; player?: PlayerIdx; value: number }
  | { type: "ANSWER"; player?: PlayerIdx; payload: AnswerPayload }
  | { type: "VERDICT"; payload: VerdictPayload }
  | { type: "BID"; player: PlayerIdx; amount: number }
  | { type: "PASS"; player: PlayerIdx }
  | { type: "FINISH" };

export interface AnswerPayload {
  text?: string;
  texts?: string[];
  choice?: number;
  score?: [number, number];
  scorer?: string;
  scorerCorrect?: boolean;
}

export interface VerdictPayload {
  correct?: boolean;
  slots?: boolean[];
  id?: string | null;
  ids?: string[];
}

export type Phase = "draw" | "intro" | "playing" | "game_over" | "match_over";

export interface MatchState {
  config: MatchConfig;
  scores: [number, number];
  order: GameId[];
  gameIdx: number;
  phase: Phase;
  /** Who starts each game (index aligned with order). */
  starters: PlayerIdx[];
  /** Per-game points [game][player]. */
  gamePoints: [number, number][];
  /** Game-specific state of the current game. */
  game: GameStateAny | null;
  /** Items selected for every game at creation (deterministic). */
  content: Partial<Record<GameId, unknown[]>>;
  timer: Timer | null;
  timerSeq: number;
  events: EngineEvent[];
  coin: PlayerIdx;
}

export interface GameStateBase {
  game: GameId;
  stage: string;
  /** Player whose turn it is (if any). */
  turn: PlayerIdx | null;
  /** Points of the last resolved answer, for UI feedback. */
  last: { player: PlayerIdx | null; points: number; ok: boolean; detail?: string } | null;
  /** Narrative to show after an answer. */
  script: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameStateAny = { game: GameId } & Record<string, any>;

export interface Env {
  ctx: EngineCtx;
  judging: Judging;
  starter: PlayerIdx;
  addPoints(player: PlayerIdx, points: number): void;
  emit(e: EngineEvent): void;
  setTimer(ms: number, kind: string): void;
  clearTimer(): void;
  timerId(): number | null;
  timerKind(): string | null;
}

export interface GameModule {
  id: GameId;
  /** Number of items needed for one game, per player when perPlayer is true. */
  count: number;
  perPlayer?: boolean;
  init(items: unknown[], env: Env): GameStateAny;
  reduce(s: GameStateAny, intent: Intent, env: Env): void;
  done(s: GameStateAny): boolean;
  /** Remove information the given role must not see yet. */
  redact(s: GameStateAny, role: Role): GameStateAny;
}

export const other = (p: PlayerIdx): PlayerIdx => (p === 0 ? 1 : 0);

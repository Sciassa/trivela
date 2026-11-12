/**
 * Platform-agnostic room logic: authoritative engine state, role-filtered views,
 * permissions, timers and clock-corrected buzzer arbitration.
 * Adapters (Node `ws`, Cloudflare Durable Object) only move JSON messages.
 */
import {
  createMatch,
  reduce,
  viewFor,
  type EngineCtx,
  type Intent,
  type MatchConfig,
  type MatchState,
} from "@trivela/engine";
import type { Packs, PlayerIdx } from "@trivela/protocol";

export type ClientRole = "screen" | "host" | "p1" | "p2";

export interface Conn {
  id: string;
  role: ClientRole;
  token: string;
  /** serverTime - clientTime, estimated from pings. */
  offset: number;
  send(msg: unknown): void;
}

export type ClientMsg =
  | { t: "join"; role: ClientRole; token?: string }
  | { t: "ping"; c: number }
  | { t: "setup"; config: Omit<MatchConfig, "judging" | "seed"> & { seed?: number } }
  | { t: "intent"; intent: Intent }
  | { t: "buzz"; at: number };

export const BUZZ_WINDOW_MS = 150;

export class RoomCore {
  conns = new Map<string, Conn>();
  state: MatchState | null = null;
  timerStart = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private buzzWindow: { until: number; entries: { player: PlayerIdx; at: number }[] } | null = null;

  constructor(
    public code: string,
    private packs: Packs,
    private ctx: EngineCtx,
    private now: () => number = () => Date.now(),
  ) {}

  hasRole(role: ClientRole): boolean {
    return [...this.conns.values()].some((c) => c.role === role);
  }

  roster() {
    return { screen: this.hasRole("screen"), host: this.hasRole("host"), p1: this.hasRole("p1"), p2: this.hasRole("p2") };
  }

  onMessage(conn: Conn, msg: ClientMsg): void {
    switch (msg.t) {
      case "ping":
        conn.send({ t: "pong", c: msg.c, s: this.now() });
        return;
      case "setup":
        this.setup(conn, msg.config);
        return;
      case "intent":
        this.handleIntent(conn, msg.intent);
        return;
      case "buzz":
        this.handleBuzz(conn, msg.at);
        return;
    }
  }

  join(conn: Conn): void {
    this.conns.set(conn.id, conn);
    this.broadcastRoster();
    this.sendView(conn);
  }

  leave(id: string): void {
    this.conns.delete(id);
    this.broadcastRoster();
  }

  private setup(conn: Conn, cfg: Omit<MatchConfig, "judging" | "seed"> & { seed?: number }) {
    if (conn.role !== "screen" && conn.role !== "host") return;
    const config: MatchConfig = {
      ...cfg,
      judging: this.hasRole("host") ? "host" : "auto",
      seed: cfg.seed ?? (this.now() >>> 0),
    };
    const r = createMatch(config, this.packs, this.ctx);
    if (!r.ok) {
      conn.send({ t: "error", msg: r.reason });
      return;
    }
    this.state = r.state;
    this.broadcastViews();
  }

  /** Permission rules per role (SPEC §12.1). */
  allowed(role: ClientRole, intent: Intent): Intent | null {
    if (!this.state) return null;
    if (role === "host") return intent;
    const flow = intent.type === "START" || intent.type === "BEGIN_GAME" || intent.type === "NEXT";
    if (role === "screen") {
      if (flow && !this.hasRole("host")) return intent;
      if (!this.hasRole("host") && !this.hasRole("p1") && !this.hasRole("p2")) return intent;
      return null;
    }
    const me: PlayerIdx = role === "p1" ? 0 : 1;
    const g = this.state.game;
    if (flow) return this.hasRole("host") ? null : intent;
    switch (intent.type) {
      case "BUZZ":
      case "BID":
      case "PASS":
        return { ...intent, player: me };
      case "ANSWER":
        return { ...intent, player: me };
      case "CHOOSE":
        return { ...intent, player: me };
      case "FINISH":
        return g && g.turn === me ? intent : null;
      case "REVEAL_CLUE":
        return g && g.free && !g.out?.[me] ? intent : null;
      default:
        return null;
    }
  }

  handleIntent(conn: Conn, intent: Intent): void {
    if (intent.type === "TIMEOUT") return; // only the server fires timeouts
    const ok = this.allowed(conn.role, intent);
    if (!ok) return;
    if (ok.type === "BUZZ") {
      this.queueBuzz(ok.player, this.now());
      return;
    }
    this.apply(ok);
  }

  handleBuzz(conn: Conn, clientAt: number): void {
    if (conn.role !== "p1" && conn.role !== "p2") return;
    const player: PlayerIdx = conn.role === "p1" ? 0 : 1;
    this.queueBuzz(player, clientAt + conn.offset);
  }

  /** Collect presses for BUZZ_WINDOW_MS after the first arrival, earliest corrected time wins. */
  queueBuzz(player: PlayerIdx, at: number): void {
    const now = this.now();
    if (!this.buzzWindow) {
      this.buzzWindow = { until: now + BUZZ_WINDOW_MS, entries: [] };
      setTimeout(() => this.flushBuzz(), BUZZ_WINDOW_MS);
    }
    this.buzzWindow.entries.push({ player, at });
  }

  flushBuzz(): void {
    const w = this.buzzWindow;
    this.buzzWindow = null;
    if (!w || !w.entries.length) return;
    const first = [...w.entries].sort((a, b) => a.at - b.at)[0]!;
    this.apply({ type: "BUZZ", player: first.player });
  }

  apply(intent: Intent): void {
    if (!this.state) return;
    const prevTimer = this.state.timer?.id;
    const next = reduce(this.state, intent, this.ctx);
    if (next === this.state) return;
    this.state = next;
    if (next.timer?.id !== prevTimer) this.armTimer();
    this.broadcastViews();
  }

  private armTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const t = this.state?.timer;
    if (!t) return;
    this.timerStart = this.now();
    this.timer = setTimeout(() => this.apply({ type: "TIMEOUT", timerId: t.id }), t.ms);
  }

  viewFor(role: ClientRole) {
    if (!this.state) return null;
    return viewFor(this.state, role === "host" ? "host" : "screen");
  }

  private sendView(conn: Conn) {
    conn.send({ t: "view", state: this.viewFor(conn.role), timerStart: this.timerStart, now: this.now(), roster: this.roster() });
  }

  broadcastViews(): void {
    for (const c of this.conns.values()) this.sendView(c);
  }

  private broadcastRoster(): void {
    for (const c of this.conns.values()) c.send({ t: "roster", roster: this.roster() });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid ambiguity
export function roomCode(rand: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
}

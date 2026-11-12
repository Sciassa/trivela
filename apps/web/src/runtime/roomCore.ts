/**
 * Room authority, independent from the transport: engine state, role-filtered
 * views, permissions, timers, presence and clock-corrected buzzer arbitration.
 * It runs inside the Screen device: no server is involved (SPEC §12).
 */
import { reduce, viewFor, type EngineCtx, type Intent, type MatchState } from "@trivela/engine";
import type { PlayerIdx } from "@trivela/protocol";

export type ClientRole = "host" | "p1" | "p2";
export type AnyRole = ClientRole | "screen";

export interface Roster {
  host: boolean;
  p1: boolean;
  p2: boolean;
}

/** Messages from a phone to the Screen. */
export type UpMsg =
  | { t: "hello"; role: ClientRole; rev: number }
  | { t: "bye" }
  | { t: "ping"; c: number }
  | { t: "intent"; intent: Intent }
  /** `at` is already expressed in the Screen clock. */
  | { t: "buzz"; at: number };

/** Messages from the Screen to the phones. */
export type DownMsg =
  | { t: "view"; rev: number; state: MatchState | null; timerStart: number; now: number; roster: Roster }
  | { t: "pong"; c: number; s: number; rev: number };

/** "pub": controllers (never receives solutions). "host": the Regia. */
export type Channel = "pub" | "host" | { to: string };

export const BUZZ_WINDOW_MS = 250;
export const CLIENT_TTL_MS = 12_000;

export class RoomCore {
  state: MatchState | null = null;
  timerStart = 0;
  rev = 0;
  private clients = new Map<string, { role: ClientRole; seen: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private buzzWindow: { entries: { player: PlayerIdx; at: number }[] } | null = null;
  /** Local listener (the Screen UI). */
  onChange: () => void = () => undefined;

  constructor(
    private ctx: EngineCtx,
    private out: (ch: Channel, msg: DownMsg) => void,
    private now: () => number = () => Date.now(),
  ) {}

  hasRole(role: ClientRole): boolean {
    for (const c of this.clients.values()) if (c.role === role) return true;
    return false;
  }

  roster(): Roster {
    return { host: this.hasRole("host"), p1: this.hasRole("p1"), p2: this.hasRole("p2") };
  }

  /** A human host validates the answers when a Regia is connected. */
  judging(): "host" | "auto" {
    return this.hasRole("host") ? "host" : "auto";
  }

  /** Start (or clear, with null) the match prepared by the Screen. */
  start(state: MatchState | null, ctx: EngineCtx = this.ctx): void {
    this.ctx = ctx;
    this.state = state;
    this.armTimer();
    this.broadcast();
  }

  onMessage(clientId: string, msg: UpMsg): void {
    const known = this.clients.get(clientId);
    switch (msg.t) {
      case "hello": {
        const changed = !known || known.role !== msg.role;
        this.clients.set(clientId, { role: msg.role, seen: this.now() });
        if (changed) this.broadcast();
        else if (msg.rev !== this.rev) this.sendView(msg.role === "host" ? "host" : "pub");
        return;
      }
      case "bye":
        if (this.clients.delete(clientId)) this.broadcast();
        return;
      case "ping":
        this.out({ to: clientId }, { t: "pong", c: msg.c, s: this.now(), rev: this.rev });
        return;
      case "intent":
        if (known) this.intent(known.role, msg.intent);
        return;
      case "buzz":
        if (known && known.role !== "host") this.queueBuzz(known.role === "p1" ? 0 : 1, msg.at);
        return;
    }
  }

  /** Forget the phones that stopped sending heartbeats. */
  sweep(): void {
    const limit = this.now() - CLIENT_TTL_MS;
    let changed = false;
    for (const [id, c] of this.clients) {
      if (c.seen < limit) {
        this.clients.delete(id);
        changed = true;
      }
    }
    if (changed) this.broadcast();
  }

  /** Permission rules per role (SPEC §12.1). */
  allowed(role: AnyRole, intent: Intent): Intent | null {
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
      case "ANSWER":
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

  intent(role: AnyRole, intent: Intent): void {
    if (intent.type === "TIMEOUT") return; // only the authority fires timeouts
    const ok = this.allowed(role, intent);
    if (!ok) return;
    if (ok.type === "BUZZ") {
      this.queueBuzz(ok.player, this.now());
      return;
    }
    this.apply(ok);
  }

  /** Collect presses for BUZZ_WINDOW_MS after the first arrival: the earliest corrected time wins. */
  queueBuzz(player: PlayerIdx, at: number): void {
    if (!this.buzzWindow) {
      this.buzzWindow = { entries: [] };
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
    this.broadcast();
  }

  private armTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const t = this.state?.timer;
    if (!t) return;
    this.timerStart = this.now();
    this.timer = setTimeout(() => this.apply({ type: "TIMEOUT", timerId: t.id }), t.ms);
  }

  /** The Regia sees the solutions of the current game; everybody else the redacted view. */
  viewFor(role: AnyRole): MatchState | null {
    if (!this.state) return null;
    if (role === "host") return { ...this.state, content: {} };
    return viewFor(this.state, "screen");
  }

  private sendView(ch: "pub" | "host") {
    this.out(ch, { t: "view", rev: this.rev, state: this.viewFor(ch === "host" ? "host" : "p1"), timerStart: this.timerStart, now: this.now(), roster: this.roster() });
  }

  broadcast(): void {
    this.rev += 1;
    this.sendView("pub");
    if (this.hasRole("host")) this.sendView("host");
    this.onChange();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid ambiguity
export const CODE_LENGTH = 5;
export function roomCode(rand: () => number = Math.random): string {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
}
export const isRoomCode = (s: string) => new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(s);

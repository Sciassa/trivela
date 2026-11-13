import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineCtx, Intent, MatchState } from "@trivela/engine";
import { playEvents } from "./useMatch";
import type { TimerClock } from "../components/ui";
import { openRoom, relayParam, type RoomLink } from "./transport";
import { RoomCore, roomCode, type ClientRole, type DownMsg, type Roster, type UpMsg } from "./roomCore";

export type { ClientRole, Roster };

const NOBODY: Roster = { host: false, p1: false, p2: false };

/** Link opened by the phones; it keeps the relay override, if any. */
export function joinUrl(code: string, role: ClientRole): string {
  const relay = relayParam();
  return `${location.origin}${location.pathname}${relay ? `?relay=${encodeURIComponent(relay)}` : ""}#/join/${code}?r=${role}`;
}

function savedCode(): string {
  try {
    const old = sessionStorage.getItem("trivela.room");
    if (old) return old;
    const code = roomCode();
    sessionStorage.setItem("trivela.room", code);
    return code;
  } catch {
    return roomCode();
  }
}

/**
 * The Screen device hosts the room: it runs the engine and is the only one
 * holding questions and solutions. Phones connect through the relay.
 */
export function useHostedRoom(ctx: EngineCtx) {
  const code = useMemo(savedCode, []);
  const [connected, setConnected] = useState(false);
  const [, setTick] = useState(0);
  const core = useRef<RoomCore | null>(null);

  useEffect(() => {
    let link: RoomLink | null = null;
    const room = new RoomCore(ctx, (ch, msg) => link?.send(typeof ch === "string" ? ch : `to/${ch.to}`, msg));
    link = openRoom(code, (channel, from, msg) => channel === "up" && room.onMessage(from, msg as UpMsg), setConnected);
    link.listen("up");
    core.current = room;
    let lastRev = -1;
    room.onChange = () => {
      if (room.state && room.rev !== lastRev) playEvents(room.state.events);
      lastRev = room.rev;
      setTick((t) => t + 1);
    };
    const sweep = window.setInterval(() => room.sweep(), 3000);
    return () => {
      window.clearInterval(sweep);
      room.dispose();
      link?.close();
      core.current = null;
    };
  }, [code, ctx]);

  const room = core.current;
  return {
    code,
    connected,
    state: room?.state ?? null,
    roster: room?.roster() ?? NOBODY,
    timerStart: room?.timerStart ?? 0,
    timer: { ms: room?.timerMs ?? null, pausedLeft: room?.pausedLeft ?? null } as TimerClock,
    judging: () => core.current?.judging() ?? "auto",
    dispatch: (intent: Intent) => core.current?.intent("screen", intent),
    start: (state: MatchState | null, matchCtx?: EngineCtx) => core.current?.start(state, matchCtx),
  };
}

/** Phone side (Regia or controller): renders the views sent by the Screen. */
export function useRoom(role: ClientRole, code: string) {
  const [state, setState] = useState<MatchState | null>(null);
  const [roster, setRoster] = useState<Roster>(NOBODY);
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(false);
  const [timerStart, setTimerStart] = useState(Date.now());
  const [timer, setTimer] = useState<TimerClock>({ ms: null, pausedLeft: null });
  const link = useRef<RoomLink | null>(null);
  const offset = useRef(0);

  useEffect(() => {
    let rev = 0;
    let lastHeard = 0;
    const samples: number[] = [];
    const l = openRoom(
      code,
      (_channel, _from, raw) => {
        const m = raw as DownMsg;
        lastHeard = Date.now();
        setLive(true);
        if (m.t === "pong") {
          const now = Date.now();
          samples.push(m.s - (m.c + (now - m.c) / 2));
          offset.current = samples.slice(-9).sort((a, b) => a - b)[Math.floor(Math.min(samples.length, 9) / 2)]!;
          if (m.rev !== rev) hello();
        } else if (m.t === "view") {
          if (m.rev < rev && m.rev > rev - 1000) return; // late duplicate from another relay
          rev = m.rev;
          setState(m.state);
          setRoster(m.roster);
          setTimerStart(samples.length ? m.timerStart - offset.current : Date.now() - (m.now - m.timerStart));
          setTimer({ ms: m.timerMs, pausedLeft: m.pausedLeft });
        }
      },
      (ok) => {
        setConnected(ok);
        if (ok) {
          hello();
          for (let i = 0; i < 5; i++) window.setTimeout(ping, 150 + i * 250);
        }
      },
    );
    link.current = l;
    const hello = () => l.send("up", { t: "hello", role, rev } satisfies UpMsg);
    const ping = () => l.send("up", { t: "ping", c: Date.now() } satisfies UpMsg);
    l.listen(role === "host" ? "host" : "pub");
    l.listen(`to/${l.id}`);
    const beat = window.setInterval(() => {
      hello();
      ping();
      if (Date.now() - lastHeard > 9000) setLive(false);
    }, 3000);
    const bye = () => l.send("up", { t: "bye" } satisfies UpMsg);
    window.addEventListener("pagehide", bye);
    return () => {
      window.clearInterval(beat);
      window.removeEventListener("pagehide", bye);
      bye();
      window.setTimeout(() => l.close(), 200);
      link.current = null;
    };
  }, [role, code]);

  return {
    state,
    roster,
    code,
    connected,
    live,
    timerStart,
    timer,
    /** Host only: end the match for everybody. */
    endMatch: () => link.current?.send("up", { t: "end" } satisfies UpMsg),
    /** Host only: pause or resume the countdown, or move it by `ms`. */
    timerOp: (op: "pause" | "resume" | "add", ms?: number) => link.current?.send("up", { t: "timer", op, ms } satisfies UpMsg),
    dispatch: (intent: Intent) => link.current?.send("up", { t: "intent", intent } satisfies UpMsg),
    buzz: () => link.current?.send("up", { t: "buzz", at: Date.now() + offset.current } satisfies UpMsg),
  };
}

export type RoomClient = ReturnType<typeof useRoom>;

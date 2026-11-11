import { useEffect, useRef, useState } from "react";
import type { Intent, MatchConfig, MatchState } from "@trivela/engine";
import { playEvents } from "./useMatch";

export type Role = "screen" | "host" | "p1" | "p2";
export interface Roster {
  screen: boolean;
  host: boolean;
  p1: boolean;
  p2: boolean;
}

function wsUrl(params: Record<string, string>): string {
  const env = (import.meta.env.VITE_ROOM_SERVER as string | undefined) ?? "";
  const base = env || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  return `${base}/ws?${new URLSearchParams(params).toString()}`;
}

/** WebSocket room client with clock sync and automatic reconnection. */
export function useRoom(role: Role, code?: string) {
  const [state, setState] = useState<MatchState | null>(null);
  const [roomCode, setRoomCode] = useState(code ?? "");
  const [roster, setRoster] = useState<Roster>({ screen: false, host: false, p1: false, p2: false });
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [timerStart, setTimerStart] = useState(Date.now());
  const ws = useRef<WebSocket | null>(null);
  const offset = useRef(0);
  const codeRef = useRef(code ?? "");

  useEffect(() => {
    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      let token = "";
      try {
        token = sessionStorage.getItem(`trivela.token.${role}`) ?? "";
      } catch {
        /* ignore */
      }
      const params: Record<string, string> = { role };
      if (codeRef.current) params.room = codeRef.current;
      if (token) params.token = token;
      const sock = new WebSocket(wsUrl(params));
      ws.current = sock;
      const samples: number[] = [];
      sock.onopen = () => {
        setConnected(true);
        for (let i = 0; i < 5; i++) window.setTimeout(() => sock.readyState === 1 && sock.send(JSON.stringify({ t: "ping", c: Date.now() })), i * 200);
      };
      sock.onmessage = (ev) => {
        const m = JSON.parse(ev.data as string);
        if (m.t === "joined") {
          codeRef.current = m.code;
          setRoomCode(m.code);
          try {
            sessionStorage.setItem(`trivela.token.${role}`, m.token);
          } catch {
            /* ignore */
          }
        } else if (m.t === "pong") {
          const now = Date.now();
          const rtt = now - m.c;
          samples.push(m.s - (m.c + rtt / 2));
          offset.current = samples.slice().sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
          sock.send(JSON.stringify({ t: "offset", offset: offset.current }));
        } else if (m.t === "view") {
          setState(m.state);
          setRoster(m.roster);
          setTimerStart(Date.now() - (m.now - m.timerStart));
          if (role === "screen" && m.state) playEvents(m.state.events ?? []);
        } else if (m.t === "roster") {
          setRoster(m.roster);
        } else if (m.t === "error") {
          setError(m.msg);
        }
      };
      sock.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      ws.current?.close();
    };
  }, [role]);

  const send = (m: unknown) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(m));
  return {
    state,
    roster,
    code: roomCode,
    error,
    connected,
    timerStart,
    dispatch: (intent: Intent) => send({ t: "intent", intent }),
    buzz: () => send({ t: "buzz", at: Date.now() }),
    setup: (config: Omit<MatchConfig, "judging" | "seed">) => {
      setError("");
      send({ t: "setup", config });
    },
  };
}

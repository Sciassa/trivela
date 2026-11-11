import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { suggest, type MatchIndex } from "@trivela/matcher";
import type { SourceRef } from "@trivela/protocol";
import type { MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";
import { GAME_NAMES } from "../rules";

/* ------------------------------------------------------------ Stage 16:9 */

export function Stage({ children, scanlines = true }: { children: ReactNode; scanlines?: boolean }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1600, window.innerHeight / 900));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="stage-wrap need-landscape">
      <RotateOverlay to="orizzontale" />
      <div className={`stage ${scanlines ? "scanlines" : ""}`} style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id="paper-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" result="g" />
          <feComponentTransfer in="g" result="a">
            <feFuncA type="table" tableValues="0 0.08" />
          </feComponentTransfer>
          <feComposite in="a" in2="SourceGraphic" operator="in" result="m" />
          <feBlend in="SourceGraphic" in2="m" mode="multiply" />
        </filter>
      </svg>
    </div>
  );
}

export function RotateOverlay({ to }: { to: "orizzontale" | "verticale" }) {
  return (
    <div className="rotate-overlay">
      <div>
        <div className="phone" />
        <p className="px" style={{ fontSize: 14, lineHeight: 1.8 }}>
          Ruota il dispositivo
          <br />
          in {to}
        </p>
      </div>
    </div>
  );
}

/** Keep the screen awake during play when supported. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const req = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        /* not allowed */
      }
    };
    void req();
    const onVis = () => document.visibilityState === "visible" && void req();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, [active]);
}

/* ------------------------------------------------------------ Scoreboard */

export function Scoreboard({ state }: { state: MatchState }) {
  const g = state.order[state.gameIdx];
  const turn = state.game?.turn as 0 | 1 | null | undefined;
  return (
    <div className="scoreboard">
      {[0, 1].map((p) => (
        <div key={p} className={`sb-player ${p === 1 ? "right" : ""} ${p === 0 ? "c-p1" : "c-p2"}`} style={{ order: p === 0 ? 0 : 2 }}>
          {p === 1 && <span className="sb-name">{state.config.players[p]}</span>}
          <span className={`sb-score ${turn === p && state.phase === "playing" ? "sb-turn" : ""}`}>{state.scores[p]}</span>
          {p === 0 && <span className="sb-name">{state.config.players[p]}</span>}
        </div>
      ))}
      <div className="sb-mid" style={{ order: 1 }}>
        {g ? GAME_NAMES[g] : "TRIVELA"}
        <small>
          GIOCO {Math.min(state.gameIdx + 1, state.order.length)}/{state.order.length}
        </small>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Timer */

export function TimerBar({ ms, start, id }: { ms: number; start: number; id: number }) {
  const [now, setNow] = useState(Date.now());
  const lastTick = useRef(-1);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [id]);
  const left = Math.max(0, ms - (now - start));
  const sec = Math.ceil(left / 1000);
  useEffect(() => {
    if (sec <= 5 && sec > 0 && sec !== lastTick.current) {
      lastTick.current = sec;
      audio.play("tick");
    }
  }, [sec]);
  return (
    <div className="row">
      <div className={`timer grow ${left < 5000 ? "hurry" : ""}`}>
        <div style={{ transform: `scaleX(${left / ms})` }} />
      </div>
      <span className="px" style={{ width: 60, textAlign: "right" }}>
        {sec}
      </span>
    </div>
  );
}

export function StateTimer({ state, start }: { state: MatchState; start: number }) {
  if (!state.timer || state.timer.kind === "feedback" || state.timer.kind === "ready") return <div style={{ height: 20 }} />;
  return <TimerBar key={state.timer.id} ms={state.timer.ms} start={start} id={state.timer.id} />;
}

/* ------------------------------------------------------------ Copione */

export function Copione({ text, sources }: { text: string | null | undefined; sources?: SourceRef[] }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    const t = window.setInterval(() => setN((x) => (x >= text.length ? x : x + 2)), 18);
    return () => window.clearInterval(t);
  }, [text]);
  if (!text) return null;
  return (
    <div className="copione" onClick={() => setN(text.length)}>
      {text.slice(0, n)}
      {n < text.length && <span className="blink">▌</span>}
      {sources && n >= text.length && <Sources sources={sources} />}
    </div>
  );
}

export function Sources({ sources }: { sources: SourceRef[] }) {
  return (
    <div className="sources" style={{ marginTop: 10 }}>
      Fonti:{" "}
      {sources.map((s, i) => (
        <span key={i}>
          {i > 0 && " · "}
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.label}
          </a>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Keyboard + answer */

const ROWS = ["QWERTYUIOP", "ASDFGHJKL'", "ZXCVBNM-"];

export function PixelKeyboard({ onKey, compact }: { onKey: (k: string) => void; compact?: boolean }) {
  const size = compact ? { minWidth: 40, height: 44, fontSize: 13 } : undefined;
  return (
    <div className="kbd">
      {ROWS.map((r) => (
        <div key={r} className="kbd-row">
          {r.split("").map((c) => (
            <button key={c} style={size} onPointerDown={(e) => (e.preventDefault(), onKey(c.toLowerCase()))}>
              {c}
            </button>
          ))}
        </div>
      ))}
      <div className="kbd-row">
        <button className="wide" onPointerDown={(e) => (e.preventDefault(), onKey("⌫"))}>
          ⌫
        </button>
        <button className="wide" style={{ minWidth: 260 }} onPointerDown={(e) => (e.preventDefault(), onKey(" "))}>
          SPAZIO
        </button>
        <button className="wide" onPointerDown={(e) => (e.preventDefault(), onKey("⏎"))}>
          OK
        </button>
      </div>
    </div>
  );
}

/**
 * Text answer with the zero-information spelling helper. The helper only sees
 * the typed text and the global index (never the question).
 */
export function AnswerBox({
  index,
  onSubmit,
  placeholder = "Scrivi la risposta",
  keyboard = true,
  submitLabel = "INVIA",
  autoFocus = true,
}: {
  index: MatchIndex;
  onSubmit: (text: string) => void;
  placeholder?: string;
  keyboard?: boolean;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [helper, setHelper] = useState(() => {
    try {
      return localStorage.getItem("trivela.speller") !== "off";
    } catch {
      return true;
    }
  });
  const sugg = useMemo(() => (helper ? suggest(text, index) : []), [text, index, helper]);
  const submit = (t = text) => {
    if (!t.trim()) return;
    onSubmit(t.trim());
    setText("");
  };
  const onKey = (k: string) => {
    audio.play("blip");
    if (k === "⌫") setText((t) => t.slice(0, -1));
    else if (k === "⏎") submit();
    else setText((t) => t + k);
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <input
          className="input"
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          inputMode={keyboard ? "none" : "text"}
        />
        <button className="btn" onClick={() => submit()}>
          {submitLabel}
        </button>
      </div>
      <div className="suggest" aria-label="Correttore ortografico">
        {sugg.map((s) => (
          <button key={s.name} onClick={() => setText(s.name)}>
            {s.name}
          </button>
        ))}
        <span className="grow" />
        <button
          onClick={() => {
            const v = !helper;
            setHelper(v);
            try {
              localStorage.setItem("trivela.speller", v ? "on" : "off");
            } catch {
              /* ignore */
            }
          }}
        >
          correttore: {helper ? "ON" : "OFF"}
        </button>
      </div>
      {keyboard && <PixelKeyboard onKey={onKey} />}
    </div>
  );
}

/* ------------------------------------------------------------ Score picker */

export function ScorePicker({ teams, onSubmit, children }: { teams: [string, string]; onSubmit: (s: [number, number]) => void; children?: ReactNode }) {
  const [s, setS] = useState<[number, number]>([0, 0]);
  const step = (i: 0 | 1, d: number) => setS((x) => (i === 0 ? [Math.max(0, x[0] + d), x[1]] : [x[0], Math.max(0, x[1] + d)]));
  return (
    <div className="col">
      <div className="row" style={{ justifyContent: "center", gap: 40 }}>
        {[0, 1].map((i) => (
          <div key={i} className="col center" style={{ gap: 8 }}>
            <span style={{ fontSize: 34 }}>{teams[i]}</span>
            <div className="row">
              <button className="btn ghost" onClick={() => step(i as 0 | 1, -1)}>
                −
              </button>
              <span className="px" style={{ fontSize: 64, minWidth: 90, textAlign: "center" }}>
                {s[i]}
              </span>
              <button className="btn ghost" onClick={() => step(i as 0 | 1, 1)}>
                +
              </button>
            </div>
          </div>
        ))}
      </div>
      {children}
      <button className="btn" onClick={() => onSubmit(s)}>
        CONFERMA
      </button>
    </div>
  );
}

export function NextButton({ onClick, label = "AVANTI ▶" }: { onClick: () => void; label?: string }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Enter" && onClick();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClick]);
  return (
    <button className="btn next" onClick={onClick}>
      {label}
    </button>
  );
}

export function Result({ last, players }: { last: { player: 0 | 1 | null; points: number; ok: boolean; detail?: string } | null; players: [string, string] }) {
  if (!last) return null;
  const who = last.player === null ? "" : players[last.player];
  return (
    <div className={`px ${last.ok ? "c-ok" : "c-ko"}`} style={{ fontSize: 22 }}>
      {last.ok ? "ESATTO!" : "NO!"} {who} {last.points > 0 ? `+${last.points}` : last.points < 0 ? last.points : ""}
    </div>
  );
}

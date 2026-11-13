import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { suggest, type MatchIndex } from "@trivela/matcher";
import type { PlayerIdx, SourceRef } from "@trivela/protocol";
import type { MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";
import { GAME_NAMES } from "../rules";
import { GAME_COLORS, GameIcon, Sprite } from "./sprites";

/* ------------------------------------------------------------ contexts */

/** True inside the scaled stage (text inputs open the typing bar on touch devices). */
const StageCtx = createContext(false);

/**
 * The host can pause the countdown or move it: `ms` is the effective duration of the running timer (null: the
 * nominal one), `pausedLeft` the time still to go while it is paused.
 */
export interface TimerClock {
  ms: number | null;
  pausedLeft: number | null;
}
export const TimerClockCtx = createContext<TimerClock>({ ms: null, pausedLeft: null });

export interface PlayMode {
  /** Screen of a room with phones connected: inputs live on the phones. */
  readonly: boolean;
  /** This device may press AVANTI / VIA. */
  flow: boolean;
  /** Controller layout (phone of a player). */
  pad: boolean;
}
export const PlayCtx = createContext<PlayMode>({ readonly: false, flow: true, pad: false });
export const usePlay = () => useContext(PlayCtx);

/* ------------------------------------------------------------ Stage */

const BASE_W = 1600;
const BASE_H = 900;

/**
 * The stage always fills the viewport: a virtual canvas of at least 1600×900
 * (smaller on phones, so that text and buttons stay big) scaled to the device.
 */
function stageMetrics() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scale = Math.max(Math.min(vw / BASE_W, vh / BASE_H), Math.min(0.6, vh / 620, vw / 1100));
  return { scale, w: Math.ceil(vw / scale), h: Math.ceil(vh / scale) };
}

export function Stage({ children }: { children: ReactNode }) {
  const [m, setM] = useState(stageMetrics);
  useLayoutEffect(() => {
    const fit = () => {
      // keep the layout still while the on-screen keyboard is open
      if (document.documentElement.dataset.typing) return;
      setM(stageMetrics());
    };
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, []);
  return (
    <StageCtx.Provider value={true}>
      <div className="stage-wrap need-landscape">
        <RotateOverlay />
        <div className={`stage ${m.h < 760 ? "short" : ""}`} style={{ width: m.w, height: m.h, transform: `scale(${m.scale})` }}>
          <Backdrop />
          <div className="stage-body">{children}</div>
          <div className="scanlines" />
        </div>
      </div>
    </StageCtx.Provider>
  );
}

/** Night stadium: stars, floodlights, crowd and pitch (pure CSS). */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <div className="bd-stars" />
      <div className="bd-stars far" />
      <div className="bd-beam left" />
      <div className="bd-beam right" />
      <div className="bd-crowd" />
      <div className="bd-pitch" />
    </div>
  );
}

export function RotateOverlay() {
  return (
    <div className="rotate-overlay">
      <div>
        <div className="phone" />
        <p className="px" style={{ fontSize: 14, lineHeight: 1.8 }}>
          Ruota il dispositivo
          <br />
          in orizzontale
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

/* ------------------------------------------------------------ Fit */

/**
 * Auto-fit: when the content is taller than the available area it is scaled
 * down (and given proportionally more width), so nothing is ever cut off.
 */
export function Fit({ children, center = false, className = "" }: { children: ReactNode; center?: boolean; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current!;
    const i = inner.current!;
    const fit = () => {
      const W = o.clientWidth;
      const H = o.clientHeight;
      if (!W || !H) return;
      const measure = (k: number) => {
        i.style.width = `${W / k}px`;
        return i.offsetHeight * k;
      };
      let k = 1;
      if (measure(1) > H) {
        let lo = 0.3;
        let hi = 1;
        for (let n = 0; n < 7; n++) {
          const mid = (lo + hi) / 2;
          if (measure(mid) <= H) lo = mid;
          else hi = mid;
        }
        k = lo;
      }
      const h = measure(k);
      i.style.transform = `translateY(${center ? Math.max(0, (H - h) / 2) : 0}px) scale(${k})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    ro.observe(i);
    // focusing an input must never scroll the clipped area
    const unscroll = () => {
      o.scrollTop = 0;
      o.scrollLeft = 0;
    };
    o.addEventListener("scroll", unscroll);
    return () => {
      ro.disconnect();
      o.removeEventListener("scroll", unscroll);
    };
  }, [center]);
  return (
    <div ref={outer} className={`fit ${className}`}>
      <div ref={inner} className="fit-inner">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Scoreboard */

function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (shown === value) return;
    const t = window.setTimeout(() => setShown((s) => s + Math.sign(value - s) * Math.max(1, Math.round(Math.abs(value - s) / 4))), 45);
    return () => window.clearTimeout(t);
  }, [shown, value]);
  return shown;
}

function PlayerCard({ state, p }: { state: MatchState; p: PlayerIdx }) {
  const score = state.scores[p];
  const shown = useCountUp(score);
  const [delta, setDelta] = useState<{ v: number; id: number } | null>(null);
  const prev = useRef(score);
  useEffect(() => {
    if (score !== prev.current) {
      setDelta({ v: score - prev.current, id: Date.now() });
      prev.current = score;
    }
  }, [score]);
  const turn = state.phase === "playing" && state.game?.turn === p;
  return (
    <div className={`hud-player p${p + 1} ${turn ? "turn" : ""}`}>
      <Sprite name="face" size={64} className="hud-face" />
      <div className="hud-id">
        <span className="hud-name">{state.config.players[p]}</span>
        <span className="hud-tag">{state.config.solo ? "ALLENAMENTO" : turn ? "▶ IN GIOCO" : `GIOCATORE ${p + 1}`}</span>
      </div>
      <span className={`hud-score ${shown !== score ? "rolling" : ""}`}>{shown}</span>
      {delta && (
        <span key={delta.id} className={`hud-delta ${delta.v > 0 ? "plus" : "minus"}`}>
          {delta.v > 0 ? `+${delta.v}` : delta.v}
        </span>
      )}
    </div>
  );
}

export function Scoreboard({ state }: { state: MatchState }) {
  const g = state.order[state.gameIdx];
  const solo = state.config.solo === true;
  return (
    <header className={`hud ${solo ? "solo" : ""}`}>
      <PlayerCard state={state} p={0} />
      <div className="hud-mid" style={{ "--game": g ? GAME_COLORS[g] : "var(--accent)" } as CSSProperties}>
        <div className="hud-game">
          {g ? <GameIcon game={g} size={40} /> : <Sprite name="ball" size={40} />}
          <span>{g ? GAME_NAMES[g] : "TRIVELA"}</span>
        </div>
        <div className="hud-pips">
          {state.order.map((x, k) => (
            <i key={`${x}${k}`} className={k < state.gameIdx ? "done" : k === state.gameIdx ? "now" : ""} />
          ))}
        </div>
      </div>
      {solo ? <div /> : <PlayerCard state={state} p={1} />}
    </header>
  );
}

/* ------------------------------------------------------------ Timer */

/** Seconds left on a countdown, ticking every 100 ms (a paused one stays where it is). */
export function useTimeLeft(ms: number, start: number, pausedLeft: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (pausedLeft !== null) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [pausedLeft]);
  return pausedLeft ?? Math.max(0, ms - (now - start));
}

export function TimerBar({ ms, start, id, nominal }: { ms: number; start: number; id: number; nominal?: number }) {
  const { pausedLeft } = useContext(TimerClockCtx);
  const lastTick = useRef(-1);
  const left = useTimeLeft(ms, start, pausedLeft);
  const sec = Math.ceil(left / 1000);
  useEffect(() => {
    if (pausedLeft === null && sec <= 5 && sec > 0 && sec !== lastTick.current) {
      lastTick.current = sec;
      audio.play("tick");
    }
  }, [sec, pausedLeft, id]);
  const total = Math.max(nominal ?? ms, 1);
  return (
    <div className={`timer ${left < 5000 ? "hurry" : ""} ${pausedLeft !== null ? "paused" : ""}`}>
      <div className="timer-track">
        <div className="timer-fill" style={{ transform: `scaleX(${Math.min(1, left / total)})` }} />
      </div>
      <span className="timer-num">{pausedLeft !== null ? "II" : sec}</span>
      {pausedLeft !== null && <span className="timer-pause">PAUSA · {sec}</span>}
    </div>
  );
}

export function StateTimer({ state, start }: { state: MatchState; start: number }) {
  const clock = useContext(TimerClockCtx);
  if (!state.timer || state.timer.kind === "feedback" || state.timer.kind === "ready") return <div className="timer idle" />;
  return <TimerBar key={state.timer.id} ms={clock.ms ?? state.timer.ms} nominal={state.timer.ms} start={start} id={state.timer.id} />;
}

/* ------------------------------------------------------------ Copione */

export function Copione({ text, sources }: { text: string | null | undefined; sources?: SourceRef[] }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    const t = window.setInterval(() => setN((x) => (x >= text.length ? x : x + 3)), 18);
    return () => window.clearInterval(t);
  }, [text]);
  if (!text) return null;
  return (
    <div className="copione" onClick={() => setN(text.length)}>
      {/* the full text keeps the box at its final size while the typewriter runs */}
      <span className="copione-ghost">{text}</span>
      <span className="copione-text">
        {text.slice(0, n)}
        {n < text.length && <span className="blink">▌</span>}
      </span>
      {sources && <Sources sources={sources} />}
    </div>
  );
}

export function Sources({ sources }: { sources: SourceRef[] }) {
  return (
    <div className="sources">
      Fonte:{" "}
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

/* ------------------------------------------------------------ Text entry */

const isCoarse = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** The spelling helper can be switched off from the options page. */
export function spellerOn(): boolean {
  try {
    return localStorage.getItem("trivela.speller") !== "off";
  } catch {
    return true;
  }
}
export function setSpeller(on: boolean): void {
  try {
    localStorage.setItem("trivela.speller", on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

/**
 * Text field. With `index` it shows the zero-information spelling helper,
 * which only sees the typed text and the global index (never the question).
 * Inside the stage, on touch devices, typing happens in a bar pinned to the
 * top of the viewport so the on-screen keyboard never covers it.
 */
export function TextEntry({
  value,
  onChange,
  onEnter,
  index,
  placeholder = "Scrivi la risposta",
  autoFocus = false,
  numeric = false,
  color,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  index?: MatchIndex;
  placeholder?: string;
  autoFocus?: boolean;
  numeric?: boolean;
  color?: string;
}) {
  const inStage = useContext(StageCtx);
  const overlay = useMemo(() => inStage && isCoarse(), [inStage]);
  const [open, setOpen] = useState(false);
  const helper = useMemo(spellerOn, []);
  const bar = useRef<HTMLInputElement>(null);
  const sugg = useMemo(() => (index && helper ? suggest(value, index) : []), [value, index, helper]);

  const close = () => {
    setOpen(false);
    delete document.documentElement.dataset.typing;
    window.dispatchEvent(new Event("resize"));
  };
  useEffect(() => () => void (open && close()), [open]);

  const chips = index && sugg.length > 0 && (
    <div className="suggest" aria-label="Correttore ortografico">
      {sugg.map((s) => (
        <button key={s.name} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => onChange(s.name)}>
          {s.name}
        </button>
      ))}
    </div>
  );
  const common = {
    value,
    placeholder,
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "off",
    spellCheck: false,
    inputMode: numeric ? ("numeric" as const) : ("text" as const),
    enterKeyHint: "done" as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(numeric ? e.target.value.replace(/\D/g, "") : e.target.value),
  };
  if (!overlay) {
    return (
      <div className="entry">
        <input className="input" style={{ borderColor: color }} autoFocus={autoFocus} onKeyDown={(e) => e.key === "Enter" && onEnter?.()} {...common} />
        {chips}
      </div>
    );
  }
  return (
    <div className="entry">
      <button
        type="button"
        className={`input fake ${value ? "" : "empty"}`}
        style={{ borderColor: color }}
        onClick={() => {
          document.documentElement.dataset.typing = "1";
          flushSync(() => setOpen(true));
          bar.current?.focus();
        }}
      >
        {value || placeholder}
        <span className="fake-hint">✎ tocca per scrivere</span>
      </button>
      {chips}
      {open &&
        createPortal(
          <div className="typebar" onPointerDown={(e) => e.target === e.currentTarget && close()}>
            <div className="typebar-row">
              <input
                ref={bar}
                className="typebar-input"
                onBlur={close}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    close();
                    onEnter?.();
                  }
                }}
                {...common}
              />
              <button
                type="button"
                className="typebar-ok"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  close();
                  onEnter?.();
                }}
              >
                OK
              </button>
            </div>
            {chips}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Single text answer with submit button. */
export function AnswerBox({
  index,
  onSubmit,
  placeholder,
  submitLabel = "INVIA",
  autoFocus = true,
}: {
  index: MatchIndex;
  onSubmit: (text: string) => void;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText("");
  };
  return (
    <div className="answer">
      <TextEntry value={text} onChange={setText} onEnter={submit} index={index} placeholder={placeholder} autoFocus={autoFocus} />
      <button className="btn" onClick={submit}>
        {submitLabel}
      </button>
    </div>
  );
}

/** Shown on the big screen in place of the inputs when the players use their phones. */
export function PhoneHint({ text = "Si risponde dal telefono" }: { text?: string }) {
  return (
    <div className="phone-hint">
      <Sprite name="phone" size={44} /> {text}
    </div>
  );
}

/* ------------------------------------------------------------ Pickers */

/** Numeric keypad for shirt numbers (also driven by the physical keyboard). */
export function NumberPad({ onSubmit }: { onSubmit: (n: string) => void }) {
  const [v, setV] = useState("");
  const ref = useRef(v);
  ref.current = v;
  const key = (k: string) => {
    audio.play("blip");
    if (k === "⌫") setV((x) => x.slice(0, -1));
    else if (k === "OK") ref.current && onSubmit(ref.current);
    else setV((x) => (x + k).replace(/^0+(?=\d)/, "").slice(0, 2));
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) key(e.key);
      else if (e.key === "Backspace") key("⌫");
      else if (e.key === "Enter") key("OK");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="numpad">
      <div className="numpad-display led big">{v || "–"}</div>
      <div className="numpad-keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((k) => (
          <button key={k} className={`btn ${k === "OK" ? "ok" : "ghost"} sq`} disabled={k === "OK" && !v} onClick={() => key(k)}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Flow */

export function NextButton({ onClick, label = "AVANTI ▶" }: { onClick: () => void; label?: string }) {
  const { flow } = usePlay();
  useEffect(() => {
    if (!flow) return;
    const h = (e: KeyboardEvent) => e.key === "Enter" && !(e.target instanceof HTMLInputElement) && onClick();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClick, flow]);
  if (!flow) return <span className="px dim wait-host">LA REGIA PROSEGUE…</span>;
  return (
    <button className="btn next" onClick={onClick}>
      {label}
    </button>
  );
}

type Last = { player: 0 | 1 | null; points: number; ok: boolean; detail?: string; said?: string } | null;

/** What a wrong answer said, in red, so that everybody in the room can read it. */
export function WrongSaid({ text, who }: { text: string | null | undefined; who?: string }) {
  if (!text) return null;
  return (
    <div className="said-wrong" role="status">
      <span className="said-label">{who ? `${who} ha risposto:` : "Hai risposto:"}</span>
      <b>{text}</b>
    </div>
  );
}

export function Result({ last, players }: { last: Last; players: [string, string] }) {
  if (!last) return null;
  const who = last.player === null ? "" : players[last.player];
  // "3/5" (La Formazione) is a count, not a verdict: only a fully right answer says ESATTO
  const count = /^\d\/\d$/.test(last.detail ?? "") ? last.detail : null;
  const word = count ? `${count} TROVATI` : last.ok ? "ESATTO!" : "NO!";
  return (
    <>
      <div className={`result ${last.ok ? "ok" : "ko"}`}>
        <span className="result-word">{word}</span>
        {last.points !== 0 && (
          <span className="result-pts">
            {who} {last.points > 0 ? `+${last.points}` : last.points}
          </span>
        )}
      </div>
      {!last.ok && !count && <WrongSaid text={last.said} who={who} />}
    </>
  );
}

/* ------------------------------------------------------------ Effects */

const CONFETTI = ["var(--accent)", "var(--p1)", "var(--p2)", "var(--ok)", "#ffffff"];

export function Confetti({ count = 36, rain = false }: { count?: number; rain?: boolean }) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, k) => ({
        left: Math.random() * 100,
        delay: Math.random() * (rain ? 3 : 0.25),
        dur: (rain ? 2.6 : 0.9) + Math.random() * 1.2,
        dx: (Math.random() - 0.5) * 240,
        size: 10 + Math.floor(Math.random() * 3) * 6,
        color: CONFETTI[k % CONFETTI.length]!,
      })),
    [count, rain],
  );
  return (
    <div className={`confetti ${rain ? "rain" : "burst"}`} aria-hidden>
      {bits.map((b, k) => (
        <i key={k} style={{ left: `${b.left}%`, width: b.size, height: b.size, background: b.color, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, "--dx": `${b.dx}px` } as CSSProperties} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Pages (forms outside the stage) */

export function Page({ title, onBack, children, wide = false }: { title: string; onBack?: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="page">
      <div className="page-bg" aria-hidden />
      <div className={`page-body ${wide ? "wide" : ""}`}>
        <div className="page-head">
          {onBack && (
            <button className="btn ghost sq" onClick={onBack} aria-label="Indietro">
              ◀
            </button>
          )}
          <h1 className="px">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

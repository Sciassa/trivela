import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { suggest, type MatchIndex } from "@trivela/matcher";
import type { PlayerIdx, SourceRef } from "@trivela/protocol";
import type { MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";
import { GAME_SHORT } from "../rules";
import { GAME_COLORS, GameIcon, Sprite } from "./sprites";
import { Backdrop } from "./scenery";
import type { Votes } from "../runtime/roomCore";
import { HAPTIC, vibrate } from "../runtime/haptics";

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

/**
 * Screen of a room with two controllers and no Regia (SPEC §12.8): the game moves on when both phones agree, and the
 * Screen shows who has already pressed. null everywhere else.
 */
/**
 * The verdict on the last answer (SPEC §10.4): a phone held sideways shows only the keys and the typing line, so
 * the keyboard itself must say whether the name just sent was right or wrong.
 */
export interface Verdict {
  ok: boolean;
  /** Counter, a new one for each verdict. */
  id: number;
  /** What was sent, when it was typed on this device. */
  said: string | null;
}
export const VerdictCtx = createContext<Verdict | null>(null);

/** The text sent by the last answer box of this device, to be named in the verdict. */
let lastSent: { text: string; at: number } | null = null;
let verdictSeq = 0;

type MatchEvents = MatchState["events"];

/** Right or wrong in a batch of match events (only those of `player`, when given). */
export function verdictOf(events: MatchEvents | undefined, player?: PlayerIdx): boolean | null {
  const mine = (events ?? []).filter((e) => player === undefined || !("player" in e) || e.player === player);
  // a name found in La Formazione or L'Asta is announced by a notice (the name, no player)
  if (mine.some((e) => e.type === "correct" || e.type === "goal" || e.type === "notice")) return true;
  if (mine.some((e) => e.type === "wrong" || e.type === "miss")) return false;
  return null;
}

/**
 * The verdict to show for 1.6 seconds after each judged answer. `stamp` (the room revision on a phone) makes a view
 * received twice count once.
 */
export function useVerdict(events: MatchEvents | undefined, player?: PlayerIdx, stamp?: number): Verdict | null {
  const [v, setV] = useState<Verdict | null>(null);
  const last = useRef<unknown>(null);
  useEffect(() => {
    const key = stamp ?? events;
    if (key === last.current) return;
    last.current = key;
    const ok = verdictOf(events, player);
    if (ok === null) return;
    const said = lastSent && Date.now() - lastSent.at < 15_000 ? lastSent.text : null;
    lastSent = null;
    setV({ ok, id: ++verdictSeq, said });
    const t = window.setTimeout(() => setV(null), 1600);
    return () => window.clearTimeout(t);
  }, [events, player, stamp]);
  return v;
}

/** The verdict strip of the game keyboard: green with a tick, red with a cross. */
function VerdictStrip({ v }: { v: Verdict }) {
  return (
    <div key={v.id} className={`vk-verdict ${v.ok ? "ok" : "ko"}`} role="status" aria-live="assertive">
      {v.ok ? "✓ GIUSTO" : "✗ SBAGLIATO"}
      {v.said && <span className="said">«{v.said}»</span>}
    </div>
  );
}

export const VotesCtx = createContext<{ votes: Votes | null; players: [string, string] } | null>(null);

/** «AVANTI» or «PROSSIMO INDIZIO» on the Screen: a green check for each player who has pressed it on the phone. */
export function VoteBadge({ action }: { action: Votes["action"] }) {
  const ctx = useContext(VotesCtx);
  if (!ctx) return null;
  const v = ctx.votes?.action === action ? ctx.votes : null;
  const done = v ? v.who.filter(Boolean).length : 0;
  const need = v ? v.need.filter(Boolean).length : 2;
  return (
    <span className={`vote-badge ${v ? "live" : ""}`} data-votes={done} role="status">
      <span className="vote-what">{action === "clue" ? "PROSSIMO INDIZIO" : "AVANTI"} DAI TELEFONI</span>
      {([0, 1] as const)
        .filter((p) => !v || v.need[p])
        .map((p) => (
          <span key={p} className={`vote-who ${p === 0 ? "c-p1" : "c-p2"} ${v?.who[p] ? "on" : ""}`}>
            <i aria-hidden>{v?.who[p] ? "✓" : "·"}</i>
            {ctx.players[p]}
          </span>
        ))}
      <span className="vote-count">
        {done}/{need}
      </span>
    </span>
  );
}
export const usePlay = () => useContext(PlayCtx);

/* ------------------------------------------------------------ Stage */

const BASE_W = 1600;
const BASE_H = 900;

/**
 * The stage always fills the viewport: a virtual canvas of at least 1600×900
 * (smaller on phones, so that text and buttons stay big) scaled to the device.
 */
function stageMetrics(vw = window.innerWidth, vh = window.innerHeight) {
  const scale = Math.max(Math.min(vw / BASE_W, vh / BASE_H), Math.min(0.6, vh / 620, vw / 1100));
  return { scale, w: Math.ceil(vw / scale), h: Math.ceil(vh / scale) };
}

export function Stage({ children, variant = "dusk" }: { children: ReactNode; variant?: "dusk" | "sunset" }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [m, setM] = useState(() => stageMetrics());
  useLayoutEffect(() => {
    const el = wrap.current!;
    // the stage follows its own box: the window, minus the on-screen keyboard when it is docked below (SPEC §10.4).
    // While the phone is held upright the "rotate" notice covers everything and the stage keeps its size: nothing is
    // remounted, so scores, timers and typed text are still there when the phone is turned back.
    const fit = () => {
      if (el.clientWidth < 1 || el.clientHeight < 1) return;
      if (matchMedia("(orientation: portrait) and (max-width: 700px)").matches) return;
      setM(stageMetrics(el.clientWidth, el.clientHeight));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("orientationchange", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", fit);
    };
  }, []);
  return (
    <StageCtx.Provider value={true}>
      <div ref={wrap} className="stage-wrap need-landscape">
        <RotateOverlay />
        {/* --inv turns the safe-area insets of the device into units of the scaled canvas */}
        <div className={`stage ${m.h < 760 ? "short" : ""}`} style={{ width: m.w, height: m.h, transform: `scale(${m.scale})`, "--inv": 1 / m.scale } as CSSProperties}>
          <Backdrop variant={variant} />
          <div className="stage-body">{children}</div>
          <div className="scanlines" />
        </div>
      </div>
    </StageCtx.Provider>
  );
}

export function RotateOverlay() {
  return (
    <div className="rotate-overlay">
      <div>
        <div className="phone" />
        <p className="px" style={{ fontSize: 14, lineHeight: 1.8 }}>
          Per favore, ruota il dispositivo
          <br />
          in orizzontale
        </p>
        <p className="rotate-note">La partita ti aspetta: punteggi, tempo e risposta scritta restano dove li hai lasciati.</p>
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
  const [coin, setCoin] = useState(0);
  const prev = useRef(score);
  const seq = useRef(0);
  useEffect(() => {
    if (score !== prev.current) {
      // the "+N" that rises over the board is drawn by PointsPops; here only the score box flashes (a counter, not a
      // timestamp: two equal keys made React keep duplicated score boxes in the top bar)
      seq.current += 1;
      setCoin(score > prev.current ? seq.current : 0);
      prev.current = score;
    }
  }, [score]);
  const turn = state.phase === "playing" && state.game?.turn === p;
  return (
    <div className={`hud-player p${p + 1} ${turn ? "turn" : ""}`}>
      <Sprite name="face" size={64} className="hud-face" />
      <div className="hud-id">
        <span className={`hud-name ${state.config.players[p].length > 10 ? "long" : ""}`}>{state.config.players[p]}</span>
        <span className="hud-tag">{state.config.solo ? "ALLENAMENTO" : turn ? "▶ IN GIOCO" : `GIOCATORE ${p + 1}`}</span>
      </div>
      <span key={`score${coin}`} className={`hud-score ${shown !== score ? "rolling" : ""} ${coin ? "coin" : ""}`}>{shown}</span>
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
          <span>{g ? GAME_SHORT[g] : "TRIVELA"}</span>
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

export function TimerBar({ ms, start, id, nominal, grace = false }: { ms: number; start: number; id: number; nominal?: number; grace?: boolean }) {
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
    <div className={`timer ${left < 5000 ? "hurry" : ""} ${pausedLeft !== null ? "paused" : ""} ${grace ? "grace" : ""}`} data-grace={grace || undefined}>
      {grace && (
        <span className="timer-grace">
          <b>TEMPO SCADUTO · </b>FINISCI DI SCRIVERE!
        </span>
      )}
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
  return <TimerBar key={state.timer.id} ms={clock.ms ?? state.timer.ms} nominal={state.timer.ms} start={start} id={state.timer.id} grace={state.timer.grace === true} />;
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

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM'-"];

/** What a key adds: the first letter of every word is a capital, like in a name. */
function typed(value: string, key: string): string {
  const ch = /[a-z]/i.test(key) ? (value === "" || /[\s'\-]$/.test(value) ? key.toUpperCase() : key.toLowerCase()) : key;
  return (value + ch).replace(/^\s+/, "").replace(/\s{2,}/g, " ").slice(0, 40);
}

/**
 * The game's own 8-bit keyboard (SPEC §10.4). On touch devices the answer fields never open the keyboard of the
 * system, which used to cover the spelling suggestions: this one sits at the bottom of the screen, inside the safe
 * areas, and the suggestions stay in sight just above the field.
 *  - `over`: on short screens (a phone held sideways) it comes with its own strip showing the prompt, the countdown,
 *    what is being typed and the suggestions, because the board behind would not fit above the keys;
 *  - otherwise it is docked: the page (or the stage) shrinks and stays visible above it.
 */
function PixelKeyboard({
  value,
  onChange,
  onEnter,
  onClose,
  over,
  inStage,
  prompt,
  timer,
  actions,
  placeholder,
  chips,
  numeric,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  onClose: () => void;
  over: boolean;
  inStage: boolean;
  prompt?: string;
  timer?: ReactNode;
  actions?: ReactNode;
  placeholder: string;
  chips: ReactNode;
  numeric: boolean;
}) {
  const keys = useRef<HTMLDivElement>(null);
  const live = useRef({ value, onChange, onEnter, onClose });
  live.current = { value, onChange, onEnter, onClose };
  const press = (k: string) => {
    const { value: v, onChange: set, onEnter: enter, onClose: close } = live.current;
    navigator.vibrate?.(8);
    if (k === "HIDE") close();
    else if (k === "DEL") set(v.slice(0, -1));
    else if (k === "OK") enter?.();
    else if (numeric ? /\d/.test(k) : true) set(numeric ? (v + k).slice(0, 4) : typed(v, k));
  };
  // a keyboard plugged into the tablet keeps working
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Backspace") press("DEL");
      else if (e.key === "Enter") press("OK");
      else if (e.key.length === 1 && /[\p{L}\d '\-]/u.test(e.key)) press(e.key);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  // docked: tell the layout how much room the keys take
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (over) return;
    const el = keys.current!;
    const set = () => root.style.setProperty("--vk-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--vk-h");
    };
  }, [over]);
  const key = (k: string, label: ReactNode = k, cls = "") => (
    <button
      key={k}
      type="button"
      className={`vk-key ${cls}`}
      data-key={k}
      aria-label={k === "DEL" ? "Cancella" : k === "OK" ? "Invia" : k === " " ? "Spazio" : k}
      onPointerDown={(e) => {
        e.preventDefault();
        press(k);
      }}
    >
      {label}
    </button>
  );
  const verdict = useContext(VerdictCtx);
  useEffect(() => {
    if (verdict) vibrate(verdict.ok ? HAPTIC.right : HAPTIC.wrong);
  }, [verdict]);
  return (
    <div className={`vk-layer ${over ? "over" : "dock"} ${inStage ? "of-stage" : ""}`}>
      {!over && verdict && <VerdictStrip v={verdict} />}
      {over && (
        <div className="vk-top">
          {verdict && <VerdictStrip v={verdict} />}
          <div className="vk-ctx">
            <span className="vk-prompt">{prompt}</span>
            {timer}
          </div>
          <div className="vk-line">
            <div className={`vk-mirror ${value ? "" : "empty"}`}>
              {value || placeholder}
              <i className="vk-caret" />
            </div>
            {actions}
            <button type="button" className="vk-hide" onPointerDown={(e) => (e.preventDefault(), onClose())}>
              ▲ TABELLONE
            </button>
          </div>
          {chips}
        </div>
      )}
      <div ref={keys} className="vk" role="group" aria-label="Tastiera">
        {(numeric ? ["12345", "67890"] : KEY_ROWS).map((row, r, all) => (
          <div key={r} className="vk-row">
            {r === all.length - 1 && !over && key("HIDE", "▼", "wide hide")}
            {row.split("").map((k) => key(k))}
            {r === 1 && key("DEL", "CANC", "wide del")}
          </div>
        ))}
        <div className="vk-row">
          {!numeric && key(" ", "SPAZIO", "space")}
          {key("OK", "INVIA ▶", "ok")}
        </div>
      </div>
    </div>
  );
}

/**
 * Text field. With `index` it shows the zero-information spelling helper, which only sees the typed text and the
 * global index (never the question). On touch devices it is written with the game's own keyboard.
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
  prompt,
  timer,
  actions,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  index?: MatchIndex;
  placeholder?: string;
  autoFocus?: boolean;
  numeric?: boolean;
  color?: string;
  /** What is being asked, shown above the keyboard when it covers the board. */
  prompt?: string;
  /** The running countdown, shown next to the prompt. */
  timer?: ReactNode;
  /** Buttons that must stay in reach while the keyboard covers the board (e.g. "passo"). */
  actions?: ReactNode;
}) {
  const inStage = useContext(StageCtx);
  const touch = useMemo(isCoarse, []);
  const [open, setOpen] = useState(autoFocus);
  const helper = useMemo(spellerOn, []);
  const sugg = useMemo(() => (index && helper ? suggest(value, index) : []), [value, index, helper]);
  // a phone held sideways has no room for the board above the keys: the keyboard brings its own strip
  const [over, setOver] = useState(() => inStage && window.innerHeight < 560);
  useEffect(() => {
    if (!touch) return;
    const h = () => setOver(inStage && window.innerHeight < 560);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [touch, inStage]);

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
    enterKeyHint: "done" as const,
  };
  if (!touch) {
    return (
      <div className="entry">
        <input
          className="input"
          style={{ borderColor: color }}
          autoFocus={autoFocus}
          inputMode={numeric ? "numeric" : "text"}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
          onChange={(e) => onChange(numeric ? e.target.value.replace(/\D/g, "") : e.target.value)}
          {...common}
        />
        {chips}
      </div>
    );
  }
  return (
    <div className={`entry ${open ? "typing" : ""}`}>
      {/* read-only and inputmode="none": the keyboard of the system never opens, the game's one does */}
      <input className={`input vk-field ${open ? "on" : ""}`} style={{ borderColor: color }} readOnly inputMode="none" onPointerDown={() => setOpen(true)} onFocus={() => setOpen(true)} {...common} />
      {!(open && over) && chips}
      {open &&
        createPortal(
          <PixelKeyboard
            value={value}
            onChange={onChange}
            onEnter={onEnter}
            onClose={() => setOpen(false)}
            over={over}
            inStage={inStage}
            prompt={prompt}
            timer={timer}
            actions={actions}
            placeholder={placeholder}
            chips={chips}
            numeric={numeric}
          />,
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
  prompt,
  timer,
  actions,
}: {
  index: MatchIndex;
  onSubmit: (text: string) => void;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  prompt?: string;
  timer?: ReactNode;
  actions?: ReactNode;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    lastSent = { text: text.trim(), at: Date.now() };
    onSubmit(text.trim());
    setText("");
  };
  return (
    <div className="answer">
      <TextEntry value={text} onChange={setText} onEnter={submit} index={index} placeholder={placeholder} autoFocus={autoFocus} prompt={prompt} timer={timer} actions={actions} />
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

export function NextButton({ onClick, label = "AVANTI ▶", always = false }: { onClick: () => void; label?: string; /** Leaving the screen is never a vote. */ always?: boolean }) {
  const play = usePlay();
  const votes = useContext(VotesCtx);
  const flow = play.flow || always;
  useEffect(() => {
    if (!flow) return;
    const h = (e: KeyboardEvent) => e.key === "Enter" && !(e.target instanceof HTMLInputElement) && onClick();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClick, flow]);
  if (!flow) return votes ? <VoteBadge action="next" /> : <span className="px dim wait-host">LA REGIA PROSEGUE…</span>;
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

/* ------------------------------------------------------------ Exit controls */

const ICON_X = ["xx...xx", "xxx.xxx", ".xxxxx.", "..xxx..", ".xxxxx.", "xxx.xxx", "xx...xx"];
const ICON_HOME = ["...x...", "..xxx..", ".xxxxx.", "xxxxxxx", ".xx.xx.", ".xx.xx.", ".xxxxx."];

function PixelIcon({ rows, size }: { rows: string[]; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden fill="currentColor">
      {rows.flatMap((r, y) => r.split("").map((c, x) => (c === "x" ? <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} /> : null)))}
    </svg>
  );
}

/** A discreet corner button (a pixel icon, half transparent) that lights up on hover; its label shows on hover or focus. */
export function ExitButton({ kind, label, onClick }: { kind: "end" | "home"; label: string; onClick: () => void }) {
  return (
    <button className={`exit-btn ${kind}`} onClick={onClick} aria-label={label} title={label}>
      <span className="exit-label">{label}</span>
      <PixelIcon rows={kind === "end" ? ICON_X : ICON_HOME} size={22} />
    </button>
  );
}

/** A small 8-bit dialog over the stage. Escape cancels; every other key is kept away from the game behind it. */
export function ConfirmModal({ title, text, confirm, cancel = "CONTINUA", danger = true, fixed = false, onConfirm, onCancel }: { title: string; text?: string; confirm: string; cancel?: string; danger?: boolean; fixed?: boolean; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      e.stopImmediatePropagation();
      if (e.key !== "Tab") e.preventDefault();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onCancel]);
  return (
    <div className={`modal-back ${fixed ? "fixed" : ""}`} role="dialog" aria-modal="true" aria-label={title} onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <div className="modal-title">{title}</div>
        {text && <div className="modal-text">{text}</div>}
        <div className="modal-actions">
          <button className="btn ghost" autoFocus onClick={onCancel}>
            {cancel}
          </button>
          <button className={`btn ${danger ? "ko" : ""}`} onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Juice */

const WIPE_COLS = 16;
const WIPE_ROWS = 9;

/** Checkerboard curtain: the new screen is uncovered square by square (re-keyed on every transition). */
export function PixelWipe({ id }: { id: number }) {
  if (!id) return null;
  return (
    <div className="pixel-wipe" key={id} aria-hidden>
      {Array.from({ length: WIPE_COLS * WIPE_ROWS }, (_, k) => {
        const x = k % WIPE_COLS;
        const y = Math.floor(k / WIPE_COLS);
        return <i key={k} style={{ animationDelay: `${((x + y) % 2) * 60 + (x + y) * 12}ms`, background: (x + y) % 2 ? "#4b2394" : "#1b0a3f" }} />;
      })}
    </div>
  );
}

export interface Pop {
  id: number;
  value: number;
  player: PlayerIdx;
}

/** Floating "+3" that climbs and fades, with a few sparks, above the player who scored. */
export function PointsPops({ pops }: { pops: Pop[] }) {
  return (
    <>
      {pops.map((p) => (
        <div key={p.id} className={`pop-plus p${p.player + 1} ${p.value > 0 ? "up" : "down"}`} aria-hidden>
          <span>{p.value > 0 ? `+${p.value}` : p.value}</span>
          {p.value > 0 &&
            Array.from({ length: 6 }, (_, k) => (
              <i key={k} className="spark" style={{ "--a": `${k * 60 + 15}deg`, animationDelay: `${k * 25}ms` } as CSSProperties} />
            ))}
        </div>
      ))}
    </>
  );
}

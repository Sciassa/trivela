import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usedIds, viewFor, type EngineCtx, type Intent, type MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";
import { useLocalMatch } from "../runtime/useMatch";
import { rememberSeen } from "../runtime/packs";
import { ConfirmModal, Confetti, ExitButton, Fit, NextButton, PixelWipe, PlayCtx, PointsPops, Scoreboard, Stage, TimerClockCtx, useWakeLock, type PlayMode, type Pop, type TimerClock } from "../components/ui";
import { GAME_COLORS, GameIcon, Sprite } from "../components/sprites";
import { ClueBuzzer, GameView, isBuzzerGame } from "../games/GameView";
import { GAME_NAMES, GAME_RULES } from "../rules";

const LOCAL: PlayMode = { readonly: false, flow: true, pad: false };
const NO_CLOCK: TimerClock = { ms: null, pausedLeft: null };

/** Green/red flash (and confetti) after every judged answer. */
function useFx(state: MatchState) {
  const [fx, setFx] = useState<{ kind: "ok" | "ko"; id: number; party: boolean } | null>(null);
  useEffect(() => {
    const ev = state.events;
    const scored = ev.some((e) => (e.type === "correct" && e.points > 0) || e.type === "goal");
    const kind = scored || ev.some((e) => e.type === "notice") ? "ok" : ev.some((e) => e.type === "wrong" || e.type === "miss" || e.type === "false_start") ? "ko" : null;
    if (!kind) return;
    setFx({ kind, id: Date.now(), party: scored });
    const t = window.setTimeout(() => setFx(null), 1100);
    return () => window.clearTimeout(t);
  }, [state.events]);
  return fx;
}

/** Floating point gains: one per scoring event, gone after a second and a half. */
function usePops(state: MatchState): Pop[] {
  const [pops, setPops] = useState<Pop[]>([]);
  useEffect(() => {
    const fresh: Pop[] = [];
    state.events.forEach((e, k) => {
      if ((e.type === "correct" || e.type === "goal") && e.points !== 0) fresh.push({ id: Date.now() * 10 + k, value: e.points, player: e.player });
    });
    if (!fresh.length) return;
    setPops((p) => [...p, ...fresh]);
    const t = window.setTimeout(() => setPops((p) => p.filter((x) => !fresh.includes(x))), 1500);
    return () => window.clearTimeout(t);
  }, [state.events]);
  return pops;
}

/** A new curtain of squares at every change of game and at the intro, game-over and final screens. */
function useWipe(state: MatchState): number {
  const [id, setId] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (state.phase === "intro" || state.phase === "game_over" || state.phase === "match_over") setId((n) => n + 1);
  }, [state.phase, state.gameIdx]);
  return id;
}

export function MatchShell({
  state,
  dispatch,
  ctx,
  start,
  onExit,
  tableMode,
  mode = LOCAL,
  clock = NO_CLOCK,
  onAgain,
  onAbort,
}: {
  state: MatchState;
  dispatch: (i: Intent) => void;
  ctx: EngineCtx;
  start: number;
  onExit: (s: MatchState) => void;
  tableMode?: boolean;
  mode?: PlayMode;
  /** Timer adjustments made by the host (pause, +10, -10). */
  clock?: TimerClock;
  /** Play the same format again (rematch / another training run). */
  onAgain?: (s: MatchState) => void;
  /** Stop the match for good, without a result (the discreet corner button, after a confirmation). */
  onAbort?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const view = useMemo(() => viewFor(state, "screen"), [state]);
  const g = state.order[state.gameIdx];
  const fx = useFx(state);
  const pops = usePops(state);
  const wipe = useWipe(state);
  const buzzer = state.phase === "playing" && !!view.game && isBuzzerGame(view.game.game);
  return (
    <Stage>
      <PlayCtx.Provider value={mode}>
        <TimerClockCtx.Provider value={clock}>
        <div className={`shake-root ${fx?.kind === "ko" ? "shake" : ""}`}>
        <Scoreboard state={state} />
        {onAbort && state.phase !== "match_over" && (
          <ExitButton kind={state.config.solo ? "home" : "end"} label={state.config.solo ? "TORNA ALLA HOME" : "TERMINA PARTITA"} onClick={() => setAsking(true)} />
        )}
        {onAbort && state.phase === "match_over" && <ExitButton kind="home" label="TORNA ALLA HOME" onClick={() => onExit(state)} />}
        <main className={`arena ${fx ? `fx-${fx.kind}` : ""}`}>
          {fx?.party && <Confetti key={fx.id} />}
          <PointsPops pops={pops} />
          {state.phase === "draw" && (
            <Fit center>
              <Draw state={state} onStart={() => dispatch({ type: "START" })} />
            </Fit>
          )}
          {state.phase === "intro" && g && (
            <Fit center key={`intro${state.gameIdx}`}>
              <div className="splash enter" style={{ "--game": GAME_COLORS[g] } as CSSProperties}>
                <div className="px dim">
                  GIOCO {state.gameIdx + 1} DI {state.order.length}
                </div>
                <div className="game-card">
                  <GameIcon game={g} size={150} />
                  <h2>{GAME_NAMES[g]}</h2>
                </div>
                <div className="rules">
                  {GAME_RULES[g].map((r, k) => (
                    <div key={r} style={{ "--i": k } as CSSProperties}>
                      {r}
                    </div>
                  ))}
                </div>
                <div className={`px ${state.starters[state.gameIdx] === 0 ? "c-p1" : "c-p2"}`}>
                  {isBuzzerGame(g) ? "MANO AI PULSANTI!" : `INIZIA ${state.config.players[state.starters[state.gameIdx]!]}`}
                </div>
                <NextButton label="VIA! ▶" onClick={() => dispatch({ type: "BEGIN_GAME" })} />
              </div>
            </Fit>
          )}
          {state.phase === "playing" &&
            view.game &&
            (buzzer ? (
              <ClueBuzzer state={state} g={view.game} dispatch={dispatch} ctx={ctx} start={start} tableMode={tableMode} />
            ) : (
              <Fit key={`game${state.gameIdx}`}>
                <div className="view enter">
                  <GameView state={state} g={view.game} dispatch={dispatch} ctx={ctx} start={start} />
                </div>
              </Fit>
            ))}
          {state.phase === "game_over" && g && (
            <Fit center key={`over${state.gameIdx}`}>
              <div className="splash enter" style={{ "--game": GAME_COLORS[g] } as CSSProperties}>
                <div className="px c-accent" style={{ fontSize: 30 }}>
                  FINE · {GAME_NAMES[g]}
                </div>
                <div className="vs">
                  {([0, 1] as const).map((p) => (
                    <div key={p} className={`col center ${p === 0 ? "c-p1" : "c-p2"}`} style={{ gap: 12 }}>
                      <Sprite name="face" size={110} />
                      <span>{state.config.players[p]}</span>
                      <span className="led big" style={{ color: "inherit" }}>
                        +{state.gamePoints[state.gameIdx]![p]}
                      </span>
                    </div>
                  ))}
                </div>
                {state.order[state.gameIdx + 1] && (
                  <div className="row dim">
                    Prossimo gioco: <GameIcon game={state.order[state.gameIdx + 1]!} size={44} /> {GAME_NAMES[state.order[state.gameIdx + 1]!]}
                  </div>
                )}
                <NextButton label={state.order[state.gameIdx + 1] ? "AVANTI ▶" : "RISULTATO FINALE ▶"} onClick={() => dispatch({ type: "NEXT" })} />
              </div>
            </Fit>
          )}
          {state.phase === "match_over" && <MatchOver state={state} onExit={() => onExit(state)} onAgain={onAgain ? () => onAgain(state) : undefined} />}
        </main>
        </div>
        <PixelWipe id={wipe} />
        {asking && onAbort && (
          <ConfirmModal
            title={state.config.solo ? "TORNARE ALLA HOME?" : "SEI SICURO DI VOLER TERMINARE LA SFIDA?"}
            text={state.config.solo ? "L'allenamento in corso andrà perso." : "La partita si chiude subito e il punteggio non viene salvato."}
            confirm={state.config.solo ? "SÌ, ESCI" : "SÌ, TERMINA"}
            onConfirm={() => {
              setAsking(false);
              onAbort();
            }}
            onCancel={() => setAsking(false)}
          />
        )}
        </TimerClockCtx.Provider>
      </PlayCtx.Provider>
    </Stage>
  );
}

function Draw({ state, onStart }: { state: MatchState; onStart: () => void }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= state.order.length) return;
    const t = window.setTimeout(() => {
      audio.play("slot");
      setShown((s) => s + 1);
    }, 650);
    return () => window.clearTimeout(t);
  }, [shown, state.order.length]);
  const done = shown >= state.order.length;
  return (
    <div className="splash enter">
      <div className="px c-accent" style={{ fontSize: 34 }}>
        {state.config.solo ? "ALLENAMENTO" : state.config.rounds !== undefined ? `SFIDA RAPIDA · ${state.config.rounds} ROUND A TESTA` : "IL SORTEGGIO"}
      </div>
      <div className="draw-grid">
        {state.order.map((g, k) =>
          k < shown ? (
            <div key={`${g}${k}`} className="draw-card open" style={{ "--game": GAME_COLORS[g] } as CSSProperties}>
              <span className="n">{state.config.rounds !== undefined && state.order.length > 1 ? `ROUND ${k + 1}` : `GIOCO ${k + 1}`}</span>
              <GameIcon game={g} size={96} />
              {GAME_NAMES[g]}
            </div>
          ) : (
            <div key={`${g}${k}`} className="draw-card closed">
              ?
            </div>
          ),
        )}
      </div>
      {state.config.yearFrom !== null && <div className="dim">Domande dal {state.config.yearFrom} in poi (elenchi e classifiche usano tutte le stagioni).</div>}
      {!state.config.solo && (
        <div className="px" style={{ visibility: done ? "visible" : "hidden" }}>
          MONETA: INIZIA <span className={state.coin === 0 ? "c-p1" : "c-p2"}>{state.config.players[state.coin]}</span>
        </div>
      )}
      <div style={{ visibility: done ? "visible" : "hidden" }}>
        <NextButton label="SI PARTE ▶" onClick={onStart} />
      </div>
    </div>
  );
}

function MatchOver({ state, onExit, onAgain }: { state: MatchState; onExit: () => void; onAgain?: () => void }) {
  const [a, b] = state.scores;
  const winner = a === b ? null : a > b ? 0 : 1;
  if (state.config.solo) {
    const game = state.order[0]!;
    return (
      <>
        <Confetti count={40} />
        <Fit center>
          <div className="splash enter">
            <GameIcon game={game} size={130} />
            <div className="px c-accent" style={{ fontSize: 30 }}>
              ALLENAMENTO CONCLUSO
            </div>
            <div className="px dim">{GAME_NAMES[game]}</div>
            <div className="final-score">
              <span className="px">PUNTI</span>
              <span className="led big">{a}</span>
            </div>
            <div className="row">
              {onAgain && (
                <button className="btn ghost" onClick={onAgain}>
                  ANCORA ▶
                </button>
              )}
              <NextButton label="TORNA ALLA HOME" onClick={onExit} />
            </div>
          </div>
        </Fit>
      </>
    );
  }
  return (
    <>
      <Confetti rain count={60} />
      <Fit center>
        <div className="splash enter">
          <Sprite name="trophy" size={150} className="blink-slow" />
          <div className="px c-accent" style={{ fontSize: 34 }}>
            {winner === null ? "PAREGGIO!" : "VINCE"}
          </div>
          {winner !== null && <div className={`winner-name ${winner === 0 ? "c-p1" : "c-p2"}`}>{state.config.players[winner]}</div>}
          <div className="final-score">
            <span className="c-p1">{state.config.players[0]}</span>
            <span className="led big">
              {a} - {b}
            </span>
            <span className="c-p2">{state.config.players[1]}</span>
          </div>
          <div className="breakdown">
            {state.order.map((g, k) => (
              <div key={`${g}${k}`} style={{ display: "contents" }}>
                <span className="c-p1" style={{ textAlign: "right" }}>
                  +{state.gamePoints[k]![0]}
                </span>
                <span className="px dim">{GAME_NAMES[g]}</span>
                <span className="c-p2">+{state.gamePoints[k]![1]}</span>
              </div>
            ))}
          </div>
          <div className="row">
            {onAgain && (
              <button className="btn ghost" onClick={onAgain}>
                RIVINCITA ▶
              </button>
            )}
            <NextButton label="TORNA ALLA HOME" onClick={onExit} />
          </div>
        </div>
      </Fit>
    </>
  );
}

export function LocalMatch({
  initial,
  ctx,
  onExit,
  onAgain,
  onAbort,
  tableMode,
}: {
  initial: MatchState;
  ctx: EngineCtx;
  onExit: (s: MatchState) => void;
  onAgain?: (s: MatchState) => void;
  onAbort?: () => void;
  tableMode?: boolean;
}) {
  const { state, dispatch, timerStart } = useLocalMatch(initial, ctx);
  useWakeLock(true);
  useEffect(() => {
    if (state.phase === "match_over") rememberSeen(usedIds(state));
  }, [state.phase, state]);
  return <MatchShell state={state} dispatch={dispatch} ctx={ctx} start={timerStart} onExit={onExit} onAgain={onAgain} onAbort={onAbort} tableMode={tableMode} />;
}

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usedIds, viewFor, type EngineCtx, type Intent, type MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";
import { useLocalMatch } from "../runtime/useMatch";
import { rememberSeen } from "../runtime/packs";
import { Confetti, Fit, NextButton, PlayCtx, Scoreboard, Stage, TimerClockCtx, useWakeLock, type PlayMode, type TimerClock } from "../components/ui";
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

export function MatchShell({
  state,
  dispatch,
  ctx,
  start,
  onExit,
  tableMode,
  mode = LOCAL,
  clock = NO_CLOCK,
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
}) {
  const view = useMemo(() => viewFor(state, "screen"), [state]);
  const g = state.order[state.gameIdx];
  const fx = useFx(state);
  const buzzer = state.phase === "playing" && !!view.game && isBuzzerGame(view.game.game);
  return (
    <Stage>
      <PlayCtx.Provider value={mode}>
        <TimerClockCtx.Provider value={clock}>
        <Scoreboard state={state} />
        <main className={`arena ${fx ? `fx-${fx.kind}` : ""}`}>
          {fx?.party && <Confetti key={fx.id} />}
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
          {state.phase === "match_over" && <MatchOver state={state} onExit={() => onExit(state)} />}
        </main>
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
        IL SORTEGGIO
      </div>
      <div className="draw-grid">
        {state.order.map((g, k) =>
          k < shown ? (
            <div key={g} className="draw-card open" style={{ "--game": GAME_COLORS[g] } as CSSProperties}>
              <span className="n">GIOCO {k + 1}</span>
              <GameIcon game={g} size={96} />
              {GAME_NAMES[g]}
            </div>
          ) : (
            <div key={g} className="draw-card closed">
              ?
            </div>
          ),
        )}
      </div>
      {state.config.yearFrom !== null && <div className="dim">Domande dal {state.config.yearFrom} in poi (elenchi e classifiche usano tutte le stagioni).</div>}
      <div className="px" style={{ visibility: done ? "visible" : "hidden" }}>
        MONETA: INIZIA <span className={state.coin === 0 ? "c-p1" : "c-p2"}>{state.config.players[state.coin]}</span>
      </div>
      <div style={{ visibility: done ? "visible" : "hidden" }}>
        <NextButton label="SI PARTE ▶" onClick={onStart} />
      </div>
    </div>
  );
}

function MatchOver({ state, onExit }: { state: MatchState; onExit: () => void }) {
  const [a, b] = state.scores;
  const winner = a === b ? null : a > b ? 0 : 1;
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
              <div key={g} style={{ display: "contents" }}>
                <span className="c-p1" style={{ textAlign: "right" }}>
                  +{state.gamePoints[k]![0]}
                </span>
                <span className="px dim">{GAME_NAMES[g]}</span>
                <span className="c-p2">+{state.gamePoints[k]![1]}</span>
              </div>
            ))}
          </div>
          <NextButton label="FINE" onClick={onExit} />
        </div>
      </Fit>
    </>
  );
}

export function LocalMatch({ initial, ctx, onExit, tableMode }: { initial: MatchState; ctx: EngineCtx; onExit: (s: MatchState) => void; tableMode?: boolean }) {
  const { state, dispatch, timerStart } = useLocalMatch(initial, ctx);
  useWakeLock(true);
  useEffect(() => {
    if (state.phase === "match_over") rememberSeen(usedIds(state));
  }, [state.phase, state]);
  return <MatchShell state={state} dispatch={dispatch} ctx={ctx} start={timerStart} onExit={onExit} tableMode={tableMode} />;
}

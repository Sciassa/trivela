import { useEffect, useMemo, useState } from "react";
import { usedIds, viewFor, type EngineCtx, type MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";
import { useLocalMatch } from "../runtime/useMatch";
import { rememberSeen } from "../runtime/packs";
import { NextButton, Scoreboard, Stage, useWakeLock } from "../components/ui";
import { ClueBuzzer, GameView, isBuzzerGame } from "../games/GameView";
import { GAME_NAMES, GAME_RULES } from "../rules";

export function MatchShell({
  state,
  dispatch,
  ctx,
  start,
  onExit,
  tableMode,
  readonly,
}: {
  state: MatchState;
  dispatch: ReturnType<typeof useLocalMatch>["dispatch"];
  ctx: EngineCtx;
  start: number;
  onExit: (s: MatchState) => void;
  tableMode?: boolean;
  readonly?: boolean;
}) {
  const view = useMemo(() => viewFor(state, "screen"), [state]);
  const g = state.order[state.gameIdx];
  return (
    <Stage>
      <div className={readonly ? "readonly" : undefined}>
      <Scoreboard state={state} />
      {state.phase === "draw" && <Draw state={state} onStart={() => dispatch({ type: "START" })} />}
      {state.phase === "intro" && g && (
        <div className="game center">
          <div className="col center" style={{ maxWidth: 1100, textAlign: "center" }}>
            <div className="title-logo" style={{ fontSize: 56 }}>
              {GAME_NAMES[g]}
            </div>
            {GAME_RULES[g].map((r) => (
              <div key={r} style={{ fontSize: 34 }}>
                {r}
              </div>
            ))}
            <div className={`px ${state.starters[state.gameIdx] === 0 ? "c-p1" : "c-p2"}`} style={{ fontSize: 18, marginTop: 20 }}>
              {g === "mercato" || g === "giramondo" ? "Mano ai pulsanti!" : `Inizia ${state.config.players[state.starters[state.gameIdx]!]}`}
            </div>
            <NextButton label="VIA! ▶" onClick={() => dispatch({ type: "BEGIN_GAME" })} />
          </div>
        </div>
      )}
      {state.phase === "playing" && view.game && (
        isBuzzerGame(view.game.game) ? (
          <ClueBuzzer state={state} g={view.game} dispatch={dispatch} ctx={ctx} start={start} tableMode={tableMode} />
        ) : (
          <div className="game">
            <GameView state={state} g={view.game} dispatch={dispatch} ctx={ctx} start={start} />
          </div>
        )
      )}
      {state.phase === "game_over" && g && (
        <div className="game center">
          <div className="col center">
            <div className="px c-accent" style={{ fontSize: 28 }}>
              FINE {GAME_NAMES[g]}
            </div>
            <div className="px" style={{ fontSize: 22 }}>
              <span className="c-p1">
                {state.config.players[0]} +{state.gamePoints[state.gameIdx]![0]}
              </span>
              {"   "}
              <span className="c-p2">
                {state.config.players[1]} +{state.gamePoints[state.gameIdx]![1]}
              </span>
            </div>
            <NextButton onClick={() => dispatch({ type: "NEXT" })} />
          </div>
        </div>
      )}
      {state.phase === "match_over" && <MatchOver state={state} onExit={() => onExit(state)} />}
      </div>
    </Stage>
  );
}

function Draw({ state, onStart }: { state: MatchState; onStart: () => void }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= state.order.length) return;
    audio.play("slot");
    const t = window.setTimeout(() => setShown((s) => s + 1), 700);
    return () => window.clearTimeout(t);
  }, [shown, state.order.length]);
  return (
    <div className="game center">
      <div className="col center">
        <div className="px c-accent" style={{ fontSize: 26 }}>
          IL SORTEGGIO
        </div>
        {state.order.map((g, k) => (
          <div key={g} className="px" style={{ fontSize: 30, opacity: k < shown ? 1 : 0.15 }}>
            {k + 1}. {k < shown ? GAME_NAMES[g] : "????????"}
          </div>
        ))}
        <div className="dim" style={{ marginTop: 10 }}>
          Argomenti: <span className="c-p1">{state.topics[0].summary || state.topics[0].text}</span> ·{" "}
          <span className="c-p2">{state.topics[1].summary || state.topics[1].text}</span>
          {state.topics.some((t) => t.status === "broadened") && " (argomento allargato per mancanza di dati verificati)"}
        </div>
        {shown >= state.order.length && (
          <div className="col center" style={{ gap: 6 }}>
            <div className="px" style={{ fontSize: 16 }}>
              Moneta: inizia <span className={state.coin === 0 ? "c-p1" : "c-p2"}>{state.config.players[state.coin]}</span>
            </div>
            <NextButton label="SI PARTE ▶" onClick={onStart} />
          </div>
        )}
      </div>
    </div>
  );
}

function MatchOver({ state, onExit }: { state: MatchState; onExit: () => void }) {
  const [a, b] = state.scores;
  const winner = a === b ? null : a > b ? 0 : 1;
  return (
    <div className="game center">
      <div className="col center">
        <div className="title-logo" style={{ fontSize: 60 }}>
          {winner === null ? "PAREGGIO!" : "VINCE"}
        </div>
        {winner !== null && (
          <div className={`px ${winner === 0 ? "c-p1" : "c-p2"}`} style={{ fontSize: 44 }}>
            {state.config.players[winner]}
          </div>
        )}
        <div className="px" style={{ fontSize: 30 }}>
          {a} — {b}
        </div>
        <NextButton label="FINE" onClick={onExit} />
      </div>
    </div>
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

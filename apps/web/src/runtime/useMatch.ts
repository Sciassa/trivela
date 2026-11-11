import { useCallback, useEffect, useRef, useState } from "react";
import { reduce, type EngineCtx, type EngineEvent, type Intent, type MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";

/** React hook running the pure engine locally (Mode B, single screen). */
export function useLocalMatch(initial: MatchState, ctx: EngineCtx) {
  const [state, setState] = useState(initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [timerStart, setTimerStart] = useState<number>(Date.now());

  const dispatch = useCallback(
    (intent: Intent) => {
      const next = reduce(stateRef.current, intent, ctx);
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
        playEvents(next.events);
      }
    },
    [ctx],
  );

  // Timers: the engine asks for one, the runtime fires TIMEOUT.
  useEffect(() => {
    const t = state.timer;
    if (!t) return;
    setTimerStart(Date.now());
    const id = window.setTimeout(() => dispatch({ type: "TIMEOUT", timerId: t.id }), t.ms);
    return () => window.clearTimeout(id);
  }, [state.timer?.id, dispatch]);

  // Music intensity: tension in the final, faster while a timer runs.
  useEffect(() => {
    const g = state.order[state.gameIdx];
    audio.setIntensity(g === "cassaforte" && state.phase === "playing" ? 2 : state.timer ? 1 : 0);
  }, [state.timer?.id, state.phase, state.gameIdx, state.order]);

  return { state, dispatch, timerStart };
}

export function playEvents(events: EngineEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case "correct":
        audio.play(e.points > 0 ? "correct" : "blip");
        break;
      case "wrong":
        audio.play("wrong");
        break;
      case "goal":
        audio.play("goal");
        break;
      case "miss":
        audio.play(Math.random() < 0.5 ? "post" : "boo");
        break;
      case "malus":
        audio.play("sad");
        break;
      case "clue":
        audio.play("clue");
        break;
      case "buzz":
        audio.play("buzz");
        break;
      case "false_start":
        audio.play("wrong");
        break;
      case "timeout":
        audio.play("siren");
        break;
      case "reveal":
        audio.play("reveal");
        break;
      case "game_start":
        audio.play("coin");
        break;
      case "match_over":
        audio.play("fanfare");
        break;
      case "notice":
        audio.play("correct");
        break;
      default:
        break;
    }
  }
}

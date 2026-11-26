import { useState, type CSSProperties } from "react";
import { GAMES_PER_MATCH, type MatchConfig } from "@trivela/engine";
import type { GameId, PlayerIdx } from "@trivela/protocol";
import { audio } from "@trivela/audio";
import { CATALOG_GAMES, DRAW_LINE, GAME_COLORS, GAME_NAMES } from "../rules";
import { GameIcon } from "../components/sprites";

/** How the five games of a classic match are chosen (SPEC §5.4). */
export type PickMode = "draw" | "manual" | "draft";

export interface GamesChoiceValue {
  mode: PickMode;
  /** The games chosen so far, in play order, and who chose each one (draft only). */
  picks: { game: GameId; by: PlayerIdx | null }[];
  /** Draft: who chooses first, drawn when the draft starts. The other player starts the match. */
  first: PlayerIdx | null;
}

export const emptyChoice = (): GamesChoiceValue => ({ mode: "draw", picks: [], first: null });

/** In a draft the players alternate, the drawn one first: A B A B A. */
export const draftTurn = (v: GamesChoiceValue): PlayerIdx => ((v.picks.length % 2 === 0 ? v.first : 1 - (v.first ?? 0)) ?? 0) as PlayerIdx;

export const choiceReady = (v: GamesChoiceValue) => v.mode === "draw" || v.picks.length === GAMES_PER_MATCH;

/** What the choice adds to the match config: nothing for the draw. */
export function choiceConfig(v: GamesChoiceValue): Partial<MatchConfig> {
  if (v.mode === "draw" || v.picks.length !== GAMES_PER_MATCH) return {};
  const games = v.picks.map((p) => p.game);
  if (v.mode === "manual") return { forcedGames: games, pick: "manual" };
  return { forcedGames: games, pick: "draft", pickedBy: v.picks.map((p) => p.by ?? 0), starter: (1 - (v.first ?? 0)) as PlayerIdx };
}

/**
 * The games of a classic match: drawn by the app (the usual five out of twelve), chosen by hand together, or drafted, one
 * each in turn after a draw says who chooses first; the other player then starts the match.
 */
export function GamesChoice({ value, onChange, players }: { value: GamesChoiceValue; onChange: (v: GamesChoiceValue) => void; players: [string, string] }) {
  const [shake, setShake] = useState<GameId | null>(null);
  const setMode = (mode: PickMode) => {
    audio.play("select");
    // the draw of a draft happens when it starts: a new draft, a new draw
    onChange({ mode, picks: [], first: mode === "draft" ? ((Math.random() < 0.5 ? 0 : 1) as PlayerIdx) : null });
  };
  const toggle = (g: GameId) => {
    const at = value.picks.findIndex((p) => p.game === g);
    if (value.mode === "manual" && at >= 0) {
      onChange({ ...value, picks: value.picks.filter((p) => p.game !== g) });
      return;
    }
    if (at >= 0 || value.picks.length >= GAMES_PER_MATCH) {
      setShake(g);
      return;
    }
    audio.play("select");
    onChange({ ...value, picks: [...value.picks, { game: g, by: value.mode === "draft" ? draftTurn(value) : null }] });
  };
  const done = value.picks.length >= GAMES_PER_MATCH;
  const turn = value.mode === "draft" ? draftTurn(value) : null;
  return (
    <div className="field games-choice">
      <label>I {GAMES_PER_MATCH} GIOCHI</label>
      <div className="seg seg3">
        {(
          [
            ["draw", "CASUALI"],
            ["manual", "A SCELTA"],
            ["draft", "DRAFT"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={`btn ${value.mode === m ? "" : "ghost"}`} aria-pressed={value.mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {value.mode === "draw" && <span className="note">{DRAW_LINE}.</span>}
      {value.mode === "manual" && <span className="note">Scegliete insieme {GAMES_PER_MATCH} giochi: si giocano nell'ordine in cui li toccate. {done ? "Pronti!" : `Ne mancano ${GAMES_PER_MATCH - value.picks.length}.`}</span>}
      {value.mode === "draft" && value.first !== null && (
        <div className={`draft-banner ${done ? "" : turn === 0 ? "p1" : "p2"}`} aria-live="polite">
          {done ? (
            <>
              DRAFT CHIUSO · INIZIA LA PARTITA <b className={value.first === 0 ? "c-p2" : "c-p1"}>{players[1 - value.first]}</b>
            </>
          ) : (
            <>
              {value.picks.length === 0 && (
                <span className="draft-draw">
                  SORTEGGIO: SCEGLIE PER PRIMO <b className={value.first === 0 ? "c-p1" : "c-p2"}>{players[value.first]}</b> · LA PARTITA LA INIZIA <b className={value.first === 0 ? "c-p2" : "c-p1"}>{players[1 - value.first]}</b>
                </span>
              )}
              <span>
                SCEGLIE <b className={turn === 0 ? "c-p1" : "c-p2"}>{players[turn ?? 0]}</b> · SCELTA {value.picks.length + 1}/{GAMES_PER_MATCH}
              </span>
            </>
          )}
        </div>
      )}
      {value.mode !== "draw" && (
        <>
          <div className="game-pick choose">
            {CATALOG_GAMES.map((g) => {
              const at = value.picks.findIndex((p) => p.game === g);
              const by = at >= 0 ? value.picks[at]!.by : null;
              return (
                <button
                  key={g}
                  className={`${at >= 0 ? "on" : ""} ${shake === g ? "nope" : ""} ${by === null ? "" : by === 0 ? "by-p1" : "by-p2"}`}
                  style={{ "--game": GAME_COLORS[g] } as CSSProperties}
                  aria-pressed={at >= 0}
                  disabled={done && at < 0}
                  onAnimationEnd={() => setShake(null)}
                  onClick={() => toggle(g)}
                >
                  <GameIcon game={g} size={40} />
                  <span>
                    <b>{GAME_NAMES[g]}</b>
                    {by !== null && <span className="picked-by">{players[by]}</span>}
                  </span>
                  {at >= 0 && <span className="pick-n">{at + 1}</span>}
                </button>
              );
            })}
          </div>
          {value.picks.length > 0 && (
            <button className="btn small ghost" onClick={() => setMode(value.mode)}>
              {value.mode === "draft" ? "RIFAI IL DRAFT (NUOVO SORTEGGIO)" : "AZZERA LA SCELTA"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

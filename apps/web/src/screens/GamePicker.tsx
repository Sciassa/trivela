import { GAME_IDS, type GameId } from "@trivela/protocol";
import { audio } from "@trivela/audio";
import { GAME_COLORS, GameIcon } from "../components/sprites";
import { Page } from "../components/ui";
import { GAME_NAMES, GAME_RULES } from "../rules";

export type Format = { kind: "quick"; game: GameId } | { kind: "training"; game: GameId };

/** Choose the one mini-game of a Sfida Rapida (3 rounds each) or of an Allenamento (alone). */
export function GamePicker({ purpose, onPick, onBack }: { purpose: Format["kind"]; onPick: (game: GameId) => void; onBack: () => void }) {
  return (
    <Page title={purpose === "quick" ? "SFIDA RAPIDA · SCEGLI IL GIOCO" : "ALLENAMENTO · SCEGLI IL GIOCO"} onBack={onBack} wide>
      <div className="note">
        {purpose === "quick"
          ? "Due giocatori, un solo gioco: 3 round a testa (per Decina, Dischetto e Formazione, 3 giri). Vale in ogni modalità: schermo singolo o con i telefoni."
          : "Da solo, senza turni né avversari: scegli il gioco e allenati. Si gioca su un solo schermo."}
      </div>
      <div className="game-pick">
        {GAME_IDS.map((g) => (
          <button
            key={g}
            style={{ "--game": GAME_COLORS[g] } as React.CSSProperties}
            onClick={() => {
              audio.play("select");
              onPick(g);
            }}
          >
            <GameIcon game={g} size={56} />
            <span>
              <b>{GAME_NAMES[g]}</b>
              {GAME_RULES[g][0]}
            </span>
          </button>
        ))}
      </div>
    </Page>
  );
}

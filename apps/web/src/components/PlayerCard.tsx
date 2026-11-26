import type { PlayerCardData } from "@trivela/protocol";
import { Sprite } from "./sprites";

const BADGE: Record<PlayerCardData["style"], string> = { classica: "", speciale: "★ SPECIALE", leggendaria: "♛ LEGGENDARIA" };

/**
 * An original pixel-art player card (SPEC §14.3): licensed pixel photo or an 8-bit placeholder, name, flag and
 * nationality, club, role, the season and its real numbers. Three looks (classica, speciale, leggendaria) chosen from
 * objective facts by the data pipeline; there is no rating. It is the answer of Indovina la Figurina (SPEC §4.16), shown
 * only at the reveal; `wide` is that version.
 */
export function PlayerCard({ card, wide = false }: { card: PlayerCardData; wide?: boolean }) {
  return (
    <div className={`pcard ${card.style} ${wide ? "wide" : ""}`} aria-label={`Figurina di ${card.name}`}>
      {card.style === "leggendaria" && <span className="pc-shine" aria-hidden />}
      <div className="pc-photo">
        {card.photo ? <img src={`./${card.photo}`} alt={card.name} /> : <Sprite name="face" size={wide ? 96 : 128} className="pc-placeholder" />}
      </div>
      <div className="pc-body">
        <div className="pc-top">
          <span className="pc-season">
            {card.competition.toUpperCase()} {card.season}
          </span>
          {BADGE[card.style] && <span className="pc-badge">{BADGE[card.style]}</span>}
        </div>
        <div className="pc-name">{card.name}</div>
        <div className="pc-line">
          {card.flag && <img className="pc-flag" src={`./flags/${card.flag}.svg`} alt="" />}
          <span>{card.nat ?? ""}</span>
        </div>
        <div className="pc-line dim">
          {card.club} · {card.role}
        </div>
        <div className="pc-stats">
          <span>
            <b>{card.stats.presenze}</b>PRES.
          </span>
          <span>
            <b>{card.stats.gol}</b>GOL
          </span>
          <span>
            <b>{card.stats.assist}</b>ASSIST
          </span>
        </div>
        <div className="pc-credit">{card.photo ? card.credit : "Dati Transfermarkt · solo campionato"}</div>
      </div>
    </div>
  );
}

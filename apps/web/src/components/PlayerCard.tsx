import { useEffect, useState, type ReactNode } from "react";
import type { PlayerCardData } from "@trivela/protocol";
import { loadCard } from "../runtime/cards";
import { Sprite } from "./sprites";

const BADGE: Record<PlayerCardData["style"], string> = { classica: "", speciale: "★ SPECIALE", leggendaria: "♛ LEGGENDARIA" };

/**
 * An original pixel-art player card (SPEC §14.3): licensed pixel photo or an 8-bit placeholder, name, flag and
 * nationality, club, role, the season and its real numbers. Three looks (classica, speciale, leggendaria) chosen from
 * objective facts by the data pipeline; there is no rating. `wide` is the reveal version, the tall one the match prize.
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

/** The card of a player once the answer is out; until it arrives, or when there is none, the fallback. */
export function CardReveal({ entity, fallback, wide = true }: { entity: string | null | undefined; fallback: ReactNode; wide?: boolean }) {
  const [card, setCard] = useState<PlayerCardData | null>(null);
  useEffect(() => {
    let live = true;
    setCard(null);
    void loadCard(entity).then((c) => live && setCard(c));
    return () => {
      live = false;
    };
  }, [entity]);
  return card ? <PlayerCard card={card} wide={wide} /> : <>{fallback}</>;
}

const RANK: Record<PlayerCardData["style"], number> = { leggendaria: 2, speciale: 1, classica: 0 };

/**
 * «La figurina della partita»: a visual prize at the end of a match, the card of a player the match's questions were
 * about (the rarest look first, then the most goals plus assists). No collection, no currency, no market.
 */
export function MatchPrize({ people }: { people: string[] }) {
  const [card, setCard] = useState<PlayerCardData | null>(null);
  const key = people.join(",");
  useEffect(() => {
    let live = true;
    void Promise.all(people.slice(0, 60).map((p) => loadCard(p))).then((cards) => {
      const best = cards
        .filter((c): c is PlayerCardData => c !== null)
        .sort((a, b) => RANK[b.style] - RANK[a.style] || b.stats.gol + b.stats.assist - (a.stats.gol + a.stats.assist) || a.id.localeCompare(b.id))[0];
      if (live) setCard(best ?? null);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!card) return null;
  return (
    <div className="match-prize">
      <span className="px">LA FIGURINA DELLA PARTITA</span>
      <PlayerCard card={card} />
    </div>
  );
}

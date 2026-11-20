import { GAMES_PER_MATCH } from "@trivela/engine";
import { GAME_IDS, type GameId } from "@trivela/protocol";

/**
 * The catalogue of the mini-games: the only place with what the screens show of a game (SPEC §4). A new game needs
 * its id in `GAME_IDS` (packages/protocol), its engine module and one entry here (plus an icon in `components/sprites`):
 * menus, pickers, intro cards and HUD read everything from this table. Names are still provisional for some games.
 */
export interface GameInfo {
  /** Display name, upper case. */
  name: string;
  /** A shorter name for the score bar, when the full one does not fit a phone held sideways. */
  short?: string;
  /** Accent colour (HUD badge, intro card, pickers). */
  color: string;
  /** Three short lines for the intro card; the first one also describes the game in the pickers. */
  rules: string[];
}

export const GAME_CATALOG: Record<GameId, GameInfo> = {
  tiro_secco: {
    name: "TIRO SECCO",
    color: "#ff5a5a",
    rules: ["2 domande a testa, ognuna di un tipo diverso.", "Curiosità, record, nomi, stagioni e campioni, vero o falso.", "Quattro risposte (o due), 25 secondi. +2 se esatta."],
  },
  mercato: {
    name: "IL MERCATO",
    color: "#ffe600",
    rules: ["2 trasferimenti, 6 indizi: 20-15-10-5-3-2 punti.", "Si prenota col pulsante: un solo tentativo.", "Chi sbaglia è fuori, l'altro scopre gli indizi con calma."],
  },
  decina: {
    name: "LA DECINA",
    color: "#ff9f1c",
    rules: ["Una categoria: servono 10 risposte in totale.", "Una a testa, 30 secondi. +2 per risposta valida.", "Due errori e sei fuori: l'altro continua da solo."],
  },
  dischetto: {
    name: "DAL DISCHETTO",
    color: "#39ff14",
    rules: ["Una Top 10 da completare.", "5 tiri a testa, 30 secondi a tiro.", "+2 per ogni nome in classifica."],
  },
  formazione: {
    name: "LA FORMAZIONE",
    color: "#2fbf4a",
    rules: ["Una partita, 5 titolari oscurati per squadra.", "Chi è in svantaggio sceglie la squadra. 60 secondi.", "5/5 = 15 · 4/5 = 10 · 3/5 = 5 · 2/5 = 3 · 1/5 = 2."],
  },
  giramondo: {
    name: "IL GIRAMONDO",
    color: "#4aa3ff",
    rules: ["2 carriere svelate in ordine cronologico.", "Si prenota col pulsante: un solo tentativo.", "Prima indovini, più vale: 12-9-6-3-1 punti."],
  },
  asta: {
    name: "L'ASTA",
    color: "#e0a060",
    rules: ["2 categorie: quanti nomi sai dire?", "Chi vince l'asta ha 60 secondi per dirne quanti ne ha puntati.", "Ci riesce: +puntata. Fallisce: +5 all'avversario."],
  },
  maglia: {
    name: "LA MAGLIA",
    color: "#00e5ff",
    rules: ["2 giocatori a testa: squadra e stagione.", "Che numero aveva sulla maglia?", "+3 per ogni numero esatto."],
  },
  testa_a_testa: {
    name: "TESTA A TESTA",
    color: "#ff6fb5",
    rules: ["Un duello su una catena di giocatori: una statistica, a turno.", "Il prossimo ne ha PIÙ o MENO? Giusto +1, e la palla passa.", "Chi sbaglia per primo regala +3 all'avversario."],
  },
  bandiere: {
    name: "LE BANDIERE",
    color: "#7bdff2",
    rules: ["2 formazioni a testa: undici bandiere in campo.", "Le vedi per 5 secondi, poi spariscono.", "Quale squadra era? Quattro risposte, +2 se esatta."],
  },
};

/** Games in catalogue order (the order of `GAME_IDS`), for menus and pickers. */
export const CATALOG_GAMES: GameId[] = [...GAME_IDS];
/** «5 giochi sorteggiati su 10»: counted from the catalogue, never written by hand. */
export const DRAW_LINE = `${GAMES_PER_MATCH} giochi sorteggiati su ${CATALOG_GAMES.length}`;

const pick = <K extends keyof GameInfo>(k: K) => Object.fromEntries(GAME_IDS.map((g) => [g, GAME_CATALOG[g][k]])) as Record<GameId, GameInfo[K]>;
export const GAME_NAMES = pick("name");
/** The name in the score bar and on the phones' header: the short one when there is one. */
export const GAME_SHORT = Object.fromEntries(GAME_IDS.map((g) => [g, GAME_CATALOG[g].short ?? GAME_CATALOG[g].name])) as Record<GameId, string>;
export const GAME_RULES = pick("rules");
export const GAME_COLORS = pick("color");

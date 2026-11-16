import type { GameId } from "@trivela/protocol";

/** Display names live only here: some are still provisional. */
export const GAME_NAMES: Record<GameId, string> = {
  tiro_secco: "TIRO SECCO",
  mercato: "IL MERCATO",
  decina: "LA DECINA",
  dischetto: "DAL DISCHETTO",
  formazione: "LA FORMAZIONE",
  giramondo: "IL GIRAMONDO",
  asta: "L'ASTA",
  maglia: "LA MAGLIA",
  quotazione: "LA QUOTAZIONE",
  testa_a_testa: "TESTA A TESTA",
};

export const GAME_RULES: Record<GameId, string[]> = {
  tiro_secco: ["2 domande a testa: curiosità, record rarissimi e giochi di nomi.", "Quattro risposte, 25 secondi.", "+2 per ogni risposta esatta."],
  mercato: ["2 trasferimenti, 6 indizi: 20-15-10-5-3-2 punti.", "Si prenota col pulsante: un solo tentativo.", "Chi sbaglia è fuori, l'altro scopre gli indizi con calma."],
  decina: ["Una categoria: servono 10 risposte in totale.", "Una a testa, 30 secondi. +2 per risposta valida.", "Due errori e sei fuori: l'altro continua da solo."],
  dischetto: ["Una Top 10 da completare.", "5 tiri a testa, 30 secondi a tiro.", "+2 per ogni nome in classifica."],
  formazione: ["Una partita, 5 titolari oscurati per squadra.", "Chi è in svantaggio sceglie la squadra. 60 secondi.", "5/5 = 15 · 4/5 = 10 · 3/5 = 5 · 2/5 = 3 · 1/5 = 2."],
  giramondo: ["2 carriere svelate in ordine cronologico.", "Si prenota col pulsante: un solo tentativo.", "Prima indovini, più vale: 12-9-6-3-1 punti."],
  asta: ["2 categorie: quanti nomi sai dire?", "Chi vince l'asta ha 60 secondi per dirne quanti ne ha puntati.", "Ci riesce: +puntata. Fallisce: +5 all'avversario."],
  maglia: ["2 giocatori a testa: squadra e stagione.", "Che numero aveva sulla maglia?", "+3 per ogni numero esatto."],
  quotazione: ["2 giocatori: la curva del valore di mercato si scopre da sinistra.", "Si prenota col pulsante: un solo tentativo.", "Meno curva vedi, più vale: 15-12-9-6-3-1 punti."],
  testa_a_testa: ["Una catena a testa, sempre sulla stessa statistica.", "Il prossimo ha PIÙ o MENO? Poi incassi o rilanci.", "Il piatto sale 1-2-3-5-8-12: un errore e lo perdi."],
};

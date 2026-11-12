import type { GameId } from "@trivela/protocol";

/** Display names live only here: some are still provisional. */
export const GAME_NAMES: Record<GameId, string> = {
  tiro_secco: "TIRO SECCO",
  prima_pagina: "PRIMA PAGINA",
  mercato: "IL MERCATO",
  decina: "LA DECINA",
  dischetto: "DAL DISCHETTO",
  formazione: "LA FORMAZIONE",
  giramondo: "IL GIRAMONDO",
  frame: "IL FRAME",
  asta: "L'ASTA",
  maglia: "LA MAGLIA",
};

export const GAME_RULES: Record<GameId, string[]> = {
  tiro_secco: ["2 domande a testa, a turno.", "Quattro risposte, 20 secondi.", "+2 per ogni risposta esatta."],
  prima_pagina: ["Una prima pagina a testa, con due nomi oscurati.", "45 secondi per scoprirli.", "+2 per ogni nome indovinato."],
  mercato: ["2 trasferimenti, 6 indizi: 20-15-10-5-3-2 punti.", "Si prenota col pulsante: un solo tentativo.", "Chi sbaglia è fuori, l'altro scopre gli indizi con calma."],
  decina: ["Una categoria: servono 10 risposte in totale.", "Una a testa, 30 secondi. +2 per risposta valida.", "Due errori e sei fuori: l'altro continua da solo."],
  dischetto: ["Una Top 10 da completare.", "5 tiri a testa, 30 secondi a tiro.", "+2 per ogni nome in classifica."],
  formazione: ["Una partita, 5 titolari oscurati per squadra.", "Chi è in svantaggio sceglie la squadra. 60 secondi.", "5/5 = 15 · 4/5 = 10 · 3/5 = 5 · 2/5 = 3 · 1/5 = 2."],
  giramondo: ["2 carriere svelate in ordine cronologico.", "Si prenota col pulsante: un solo tentativo.", "Prima indovini, più vale: 12-9-6-3-1 punti."],
  frame: ["2 partite a testa: qual era il risultato a quel minuto?", "Risultato esatto +3, solo il segno +1.", "Bonus +2 se sai chi aveva segnato l'ultimo gol."],
  asta: ["2 categorie: quanti nomi sai dire?", "Chi vince l'asta ha 60 secondi per dirne quanti ne ha puntati.", "Ci riesce: +puntata. Fallisce: +5 all'avversario."],
  maglia: ["2 giocatori a testa: squadra e stagione.", "Che numero aveva sulla maglia?", "+3 per ogni numero esatto."],
};

import type { GameId } from "@trivela/protocol";

export const GAME_NAMES: Record<GameId, string> = {
  tiro_secco: "TIRO SECCO",
  prima_pagina: "PRIMA PAGINA",
  mercato: "IL MERCATO",
  decina: "LA DECINA",
  dischetto: "DAL DISCHETTO",
  formazione: "LA FORMAZIONE",
  cassaforte: "LA CASSAFORTE",
  giramondo: "IL GIRAMONDO",
  frame: "IL FRAME",
  intruso: "L'INTRUSO",
  asta: "L'ASTA",
  filo_rosso: "IL FILO ROSSO",
  mappamondo: "IL MAPPAMONDO",
  maglia: "LA MAGLIA",
};

export const GAME_RULES: Record<GameId, string[]> = {
  tiro_secco: ["4 domande a testa, a turno.", "Risposta multipla A/B/C/D, 20 secondi.", "+2 per ogni risposta esatta."],
  prima_pagina: [
    "Un ritaglio di giornale a testa, dal tuo argomento.",
    "Due elementi oscurati da indovinare in 45 secondi.",
    "+2 per ogni elemento indovinato.",
  ],
  mercato: [
    "3 trasferimenti, 6 indizi progressivi: 20-15-10-5-3-2 punti.",
    "Si prenota col pulsante. Un solo tentativo a profilo.",
    "Chi sbaglia è fuori: l'altro può scoprire gli indizi con calma.",
  ],
  decina: [
    "Una categoria da 14-17 risposte: ne servono 10 in totale.",
    "Una a testa, 30 secondi a turno. +2 per risposta valida.",
    "Due errori e sei fuori: l'altro continua da solo.",
  ],
  dischetto: [
    "Completa la Top 10 di sempre.",
    "5 tiri a testa, 30 secondi a tiro.",
    "+2 per ogni nome in classifica. Pari merito al 10° posto: ne basta uno.",
  ],
  formazione: [
    "Una partita storica, 5 titolari oscurati per squadra.",
    "Chi è in svantaggio sceglie la squadra. 60 secondi.",
    "5/5 = 15 · 4/5 = 10 · 3/5 = 5 · 2/5 = 3 · 1/5 = 2.",
  ],
  cassaforte: [
    "3 domande sul tuo argomento: Facile, Media, Difficile. Ne giochi 2.",
    "Facile +10 / −30 · Media +20 / −20 · Difficile +30 / −10.",
    "30 secondi, non si passa. Si può finire sotto zero!",
  ],
  giramondo: [
    "2 carriere svelate club per club, dal più oscuro al più famoso.",
    "Pulsante, un tentativo a profilo: 12-9-6-3-1 punti.",
  ],
  frame: ["Partita famosa, minuto preciso: qual era il risultato?", "Esatto +3, solo il segno +1, ultimo marcatore +2."],
  intruso: ["4 nomi: 3 hanno qualcosa in comune.", "Trova l'intruso (+3), poi il legame (+2)."],
  asta: [
    "Si rilancia: quanti ne sai dire di questa categoria?",
    "Chi vince l'asta deve dirne tanti quanti ha puntato in 60 secondi.",
    "Successo: +puntata. Fallimento: +5 all'avversario.",
  ],
  filo_rosso: [
    "Collega due giocatori con una catena di compagni di squadra.",
    "Catena più corta possibile +10, un anello in più +5, valida +2.",
  ],
  mappamondo: ["Dove si è giocata? Piazza il segnaposto.", "< 25 km +5 · < 100 km +3 · < 300 km +1."],
  maglia: ["Squadra, torneo, numero: chi indossava quella maglia?", "+3 per risposta esatta."],
};

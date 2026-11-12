/**
 * Shared contracts between data packs, the game engine and the web app.
 * Everything here is plain JSON-serialisable data.
 */

export const GAME_IDS = [
  "tiro_secco",
  "prima_pagina",
  "mercato",
  "decina",
  "dischetto",
  "formazione",
  "giramondo",
  "frame",
  "asta",
  "maglia",
] as const;

export type GameId = (typeof GAME_IDS)[number];

/**
 * Domestic leagues the player can switch on and off (SPEC §3.4). Questions
 * about national teams and big tournaments (World Cup, Euros, Champions
 * League, Europa and Conference League, UEFA Super Cup) are always included.
 * `cups` are the domestic cups that follow their league.
 */
export const LEAGUES = [
  { id: "IT1", name: "Serie A", cups: ["CIT", "SCI"] },
  { id: "GB1", name: "Premier League", cups: [] },
  { id: "ES1", name: "LaLiga", cups: [] },
  { id: "L1", name: "Bundesliga", cups: [] },
  { id: "FR1", name: "Ligue 1", cups: [] },
] as const;
export type LeagueId = (typeof LEAGUES)[number]["id"];

/**
 * Domestic competitions an instance belongs to (the `comp:` tags in `entities`),
 * with cups mapped to their league. Empty: the instance is always eligible.
 */
export function leaguesOf(item: { entities: string[] }): string[] {
  const out = new Set<string>();
  for (const e of item.entities) {
    if (!e.startsWith("comp:")) continue;
    const c = e.slice(5);
    const lg = LEAGUES.find((l) => l.id === c || (l.cups as readonly string[]).includes(c));
    if (lg) out.add(lg.id);
  }
  return [...out];
}
/** Every game can be drawn (there is no fixed final game). */
export type PoolGameId = GameId;
export type PlayerIdx = 0 | 1;
export type Role = "screen" | "host" | "p1" | "p2";

export interface SourceRef {
  family: string;
  label: string;
  url: string;
}

/** Metadata carried by every question instance. */
export interface InstanceMeta {
  /** Stable id: hash(generator + params). */
  id: string;
  /** Generator id; matches are sampled evenly across generators for variety. */
  generator: string;
  yearMin: number;
  yearMax: number;
  /** For person-based games: last active year of the protagonists. */
  activeYears?: number[];
  difficulty: 1 | 2 | 3;
  fame: number;
  entities: string[];
  sources: SourceRef[];
  /** Narrative shown/read after the answer. Built only from the instance facts. */
  script: string;
  snapshot?: string;
}

export type EntityKind = "person";

export interface EntityRecord {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  fame: number;
  family?: string;
}

/** Accepted answer for a single slot. */
export type AnswerKey =
  | { kind: "entity"; ids: string[]; display: string }
  | { kind: "text"; accepted: string[]; display: string }
  | { kind: "number"; value: number; display: string };

export interface TiroSeccoItem extends InstanceMeta {
  question: string;
  options: [string, string, string, string];
  correct: 0 | 1 | 2 | 3;
  archetype: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Newspaper page. Text fields may contain tokens "{{0}}" / "{{1}}" for hidden slots. */
export interface NewspaperPage {
  masthead: string;
  date: string;
  weekday: string;
  kicker: string;
  headline: string;
  subhead: string;
  body: string[];
  boxTitle: string;
  boxLines: string[];
}

export interface PrimaPaginaSlot {
  label: string;
  answer: AnswerKey;
  /** 1 short, 2 medium, 3 long: never the exact length. */
  lengthBucket: 1 | 2 | 3;
}

export interface PrimaPaginaItem extends InstanceMeta {
  page: NewspaperPage;
  slots: [PrimaPaginaSlot, PrimaPaginaSlot];
}

export interface MercatoItem extends InstanceMeta {
  /** Six clues in reveal order: price, window, role, nationality, from, to. */
  clues: string[];
  flag?: string;
  answer: AnswerKey;
}

export interface SetItem extends InstanceMeta {
  title: string;
  description: string;
  members: { id: string; name: string }[];
}

export interface DischettoItem extends InstanceMeta {
  title: string;
  definition: string;
  unit: string;
  /** "Il 1° ha 55 gol, il 10° ne ha 22." */
  hint: string;
  ranking: { rank: number; id: string; name: string; value: number; label?: string }[];
}

export interface FormazionePlayer {
  id: string;
  name: string;
  number?: number | null;
  x: number;
  y: number;
  hidden: boolean;
}

export interface FormazioneTeam {
  id: string;
  name: string;
  formation: string;
  players: FormazionePlayer[];
}

export interface FormazioneItem extends InstanceMeta {
  title: string;
  date: string;
  competition: string;
  teams: [FormazioneTeam, FormazioneTeam];
}

export interface GiramondoItem extends InstanceMeta {
  /** Career steps in chronological order, grouped in five clues. */
  clues: string[];
  answer: AnswerKey;
}

export interface FrameItem extends InstanceMeta {
  match: string;
  date: string;
  minute: number;
  teams: [string, string];
  scoreAt: [number, number];
  lastScorer?: AnswerKey;
}

/** Player + club + season: the answer is the shirt number. */
export interface MagliaItem extends InstanceMeta {
  player: string;
  team: string;
  season: string;
  question: string;
  answer: AnswerKey;
}

export interface PackItems {
  tiro_secco: TiroSeccoItem[];
  prima_pagina: PrimaPaginaItem[];
  mercato: MercatoItem[];
  decina: SetItem[];
  dischetto: DischettoItem[];
  formazione: FormazioneItem[];
  giramondo: GiramondoItem[];
  frame: FrameItem[];
  asta: SetItem[];
  maglia: MagliaItem[];
}

export interface PackManifest {
  version: string;
  generatedAt: string;
  snapshot: string;
  counts: Partial<Record<GameId, number>>;
  sources: { family: string; label: string; url: string; licence: string }[];
}

export interface Packs {
  manifest: PackManifest;
  items: PackItems;
  entities: EntityRecord[];
}

export function emptyPackItems(): PackItems {
  return { tiro_secco: [], prima_pagina: [], mercato: [], decina: [], dischetto: [], formazione: [], giramondo: [], frame: [], asta: [], maglia: [] };
}

/**
 * Shared contracts between data packs, the game engine, the web app and the
 * realtime server. Everything here is plain JSON-serialisable data.
 */

export const GAME_IDS = [
  "tiro_secco",
  "prima_pagina",
  "mercato",
  "decina",
  "dischetto",
  "formazione",
  "cassaforte",
  "giramondo",
  "frame",
  "intruso",
  "asta",
  "filo_rosso",
  "mappamondo",
  "maglia",
] as const;

export type GameId = (typeof GAME_IDS)[number];
export type PoolGameId = Exclude<GameId, "cassaforte">;
export type PlayerIdx = 0 | 1;
export type Role = "screen" | "host" | "p1" | "p2";

/* ------------------------------------------------------------------ */
/* Sources and verification                                            */
/* ------------------------------------------------------------------ */

export interface SourceRef {
  /** Source family (independence group), e.g. "wikimedia", "openfootball", "statsbomb". */
  family: string;
  /** Human readable label, e.g. "Wikipedia (en): 1990 FIFA World Cup Group A". */
  label: string;
  url: string;
}

/** Metadata carried by every question instance. */
export interface InstanceMeta {
  /** Stable id: hash(generator + params). */
  id: string;
  generator: string;
  /** Earliest / latest year of the facts used (season 2005/06 counts as 2005). */
  yearMin: number;
  yearMax: number;
  /** For person-based games: the player has at least one season >= ANNO. */
  activeYears?: number[];
  difficulty: 1 | 2 | 3;
  fame: number;
  /** Entity ids involved (used by free-topic selection and tournament dedup). */
  entities: string[];
  /** At least two families are always present. */
  sources: SourceRef[];
  /** Narrative shown/read after the answer. Built only from the instance facts. */
  script: string;
  /** Data snapshot date (ISO) for cumulative statistics. */
  snapshot?: string;
}

/* ------------------------------------------------------------------ */
/* Entities (global index used by the matcher and the topic parser)    */
/* ------------------------------------------------------------------ */

export type EntityKind = "person" | "club" | "nation" | "city" | "competition" | "edition" | "match";

export interface EntityRecord {
  id: string;
  kind: EntityKind;
  /** Display name (Italian when available). */
  name: string;
  /** Alternative names coming from sources only. */
  aliases: string[];
  fame: number;
  /** Optional first name / surname split for persons. */
  given?: string;
  family?: string;
  /** Years of activity (persons) or year (editions, matches). */
  years?: number[];
}

/** Accepted answer for a single slot. */
export type AnswerKey =
  | { kind: "entity"; ids: string[]; display: string }
  | { kind: "text"; accepted: string[]; display: string }
  | { kind: "number"; value: number; display: string };

/* ------------------------------------------------------------------ */
/* Question instances per game                                         */
/* ------------------------------------------------------------------ */

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

export interface PrimaPaginaItem extends InstanceMeta {
  page: NewspaperPage;
  slots: [PrimaPaginaSlot, PrimaPaginaSlot];
}

export interface PrimaPaginaSlot {
  label: string;
  answer: AnswerKey;
  /** 1 short, 2 medium, 3 long: never the exact length. */
  lengthBucket: 1 | 2 | 3;
}

export interface MercatoItem extends InstanceMeta {
  /** Six clues in reveal order: price, window, role, nationality, from, to. */
  clues: [string, string, string, string, string, string];
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
  ranking: { rank: number; id: string; name: string; value: number }[];
}

export interface FormazionePlayer {
  id: string;
  name: string;
  number?: number;
  /** Pitch coordinates 0..1 (x = width, y = from own goal). */
  x: number;
  y: number;
  hidden: boolean;
}

export interface FormazioneItem extends InstanceMeta {
  title: string;
  date: string;
  competition: string;
  teams: [FormazioneTeam, FormazioneTeam];
}

export interface FormazioneTeam {
  id: string;
  name: string;
  formation: string;
  players: FormazionePlayer[];
}

export interface CassaforteItem extends InstanceMeta {
  level: 1 | 2 | 3;
  question: string;
  /** One or two parts; all are required. */
  parts: AnswerKey[];
}

export interface GiramondoItem extends InstanceMeta {
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

export interface IntrusoItem extends InstanceMeta {
  names: [string, string, string, string];
  intruder: 0 | 1 | 2 | 3;
  links: [string, string, string, string];
  correctLink: 0 | 1 | 2 | 3;
}

export interface FiloRossoItem extends InstanceMeta {
  from: { id: string; name: string };
  to: { id: string; name: string };
  optimal: number;
  /** One optimal chain (ids), shown after the answer. */
  solution: { id: string; name: string }[];
}

export interface MappamondoItem extends InstanceMeta {
  question: string;
  target: { lat: number; lon: number; label: string };
}

export interface MagliaItem extends InstanceMeta {
  team: string;
  season: string;
  number: number;
  answer: AnswerKey;
}

export interface PackItems {
  tiro_secco: TiroSeccoItem[];
  prima_pagina: PrimaPaginaItem[];
  mercato: MercatoItem[];
  decina: SetItem[];
  dischetto: DischettoItem[];
  formazione: FormazioneItem[];
  cassaforte: CassaforteItem[];
  giramondo: GiramondoItem[];
  frame: FrameItem[];
  intruso: IntrusoItem[];
  asta: SetItem[];
  filo_rosso: FiloRossoItem[];
  mappamondo: MappamondoItem[];
  maglia: MagliaItem[];
}

export type ItemOf<G extends GameId> = PackItems[G][number];

/** Teammate graph: groups are team-seasons / tournament squads; members are person ids. */
export interface TeammateGraph {
  groups: Record<string, { label: string; members: string[] }>;
  byPerson: Record<string, string[]>;
}

/** Relations used to expand a free topic. */
export interface TopicGraph {
  neighbors: Record<string, string[]>;
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
  teammates: TeammateGraph;
  topics: TopicGraph;
}

export function emptyPackItems(): PackItems {
  return {
    tiro_secco: [],
    prima_pagina: [],
    mercato: [],
    decina: [],
    dischetto: [],
    formazione: [],
    cassaforte: [],
    giramondo: [],
    frame: [],
    intruso: [],
    asta: [],
    filo_rosso: [],
    mappamondo: [],
    maglia: [],
  };
}

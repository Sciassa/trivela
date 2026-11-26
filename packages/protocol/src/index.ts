/**
 * Shared contracts between data packs, the game engine and the web app.
 * Everything here is plain JSON-serialisable data.
 */

export const GAME_IDS = [
  "tiro_secco",
  "mercato",
  "decina",
  "dischetto",
  "formazione",
  "giramondo",
  "asta",
  "maglia",
  "testa_a_testa",
  "bandiere",
  "stemma",
  "figurina",
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

export type TiroSeccoTag = "record" | "nomi" | "vf" | "scheda" | "campioni" | "confronto";

export interface TiroSeccoItem extends InstanceMeta {
  question: string;
  /** Four options, or two (VERO / FALSO) for the true-or-false transfers. */
  options: string[];
  correct: number;
  archetype: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Family of the question, shown as a small label; no tag = a curiosity. "record" (rare records), "nomi" (word games
   * on names), "vf" (true or false), "scheda" (whose season is this?), "campioni" (the champions of a season),
   * "confronto" (which of four did more). The draw takes the four questions of a match from different families.
   */
  tag?: TiroSeccoTag;
  /** True-or-false transfers: the move as shown on the card. */
  transfer?: { player: string; from: string; to: string; season: string };
  /** «Di chi è questa stagione?»: the league season of the answer, as a card. */
  card?: {
    season: string;
    competition: string;
    /** The perimeter of the numbers, always one competition: «Solo Serie A». */
    scope: string;
    stats: { presenze: number; gol: number; assist: number };
    role: string;
    /** Nationality, only when it is needed to tell two identical cards apart. */
    nat: string | null;
  };
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

/** Player + club + season: the answer is the shirt number. */
export interface MagliaItem extends InstanceMeta {
  player: string;
  team: string;
  season: string;
  question: string;
  answer: AnswerKey;
}

/** Testa a Testa (SPEC §4.12): seven players and one statistic; each one is compared with the previous. */
export interface TestaItem extends InstanceMeta {
  title: string;
  definition: string;
  unit: string;
  /** In play order. `value`/`label` are null for the players not revealed yet. */
  chain: { id: string; name: string; value: number | null; label: string | null }[];
}

/** Le Bandiere (SPEC §4.14): the eleven starters of one side of a real game, as flags; the answer is the team. */
/**
 * Indovina lo Stemma (SPEC §4.15): a club crest transformed offline (or its colours as pixel bands); which club is it?
 * `original`, `team`, `credit` and `correct` reach the Screen and the phones only at the reveal: the credit names the
 * file, and the file names the club.
 */
export interface StemmaItem extends InstanceMeta {
  question: string;
  variant: "notext" | "blur" | "silhouette" | "colors";
  /** The transformed crest (a path under `crests/`); null for the colour bands. */
  image: string | null;
  /** The characteristic colours with their share of the crest, for the "colors" variant. */
  colors: [string, number][] | null;
  original: string;
  team: string;
  /** Attribution of the Commons file (author, licence): shown with the original at the reveal and in the credits. */
  credit: string;
  options: string[];
  correct: number;
}

/**
 * A player card (SPEC §14.3): real data only, never a made-up rating. The season is the player's best league season in
 * the dataset (most goals plus assists); the style follows objective thresholds.
 */
export interface PlayerCardData {
  id: string;
  name: string;
  /** Nationality in Italian and the code of its flag under `flags/` (null when there is no flag for it). */
  nat: string | null;
  flag: string | null;
  club: string;
  role: string;
  season: string;
  competition: string;
  stats: { presenze: number; gol: number; assist: number };
  /** "classica" | "speciale" (a memorable season) | "leggendaria" (a whole career at the top, see SPEC §14.3). */
  style: "classica" | "speciale" | "leggendaria";
  /** Pixel portrait under `photos/` and its credit, or null: the card then shows the 8-bit placeholder. */
  photo: string | null;
  credit: string | null;
}

/**
 * Indovina la Figurina (SPEC §4.16): a player card covered up, uncovered one line per clue while the photo sharpens.
 * `clues[k]` reads «Label: value» (role, nationality, best season and its numbers, club, year of birth); `frames[k]` is
 * the photo pixelated for step k (under `photos/`, hashed names). The Screen and the phones get the frames and clues
 * shown so far, the flag from the nationality clue on, and `card` (name, real photo, credit) only at the reveal.
 */
export interface FigurinaItem extends InstanceMeta {
  clues: string[];
  frames: string[];
  flag: string | null;
  answer: AnswerKey;
  card: PlayerCardData | null;
}

export interface BandiereItem extends InstanceMeta {
  title: string;
  date: string;
  competition: string;
  season: string;
  league: string;
  /** The module recorded for that game, when there is one («4-3-3»). */
  formation: string | null;
  team: string;
  /** x across the pitch (0 left, 1 right), y from the own goal (0) to the opponents' (1). */
  players: { id: string; name: string; nat: string; flag: string; x: number; y: number }[];
  options: string[];
  correct: number;
}

export interface PackItems {
  tiro_secco: TiroSeccoItem[];
  mercato: MercatoItem[];
  decina: SetItem[];
  dischetto: DischettoItem[];
  formazione: FormazioneItem[];
  giramondo: GiramondoItem[];
  asta: SetItem[];
  maglia: MagliaItem[];
  testa_a_testa: TestaItem[];
  bandiere: BandiereItem[];
  stemma: StemmaItem[];
  figurina: FigurinaItem[];
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
  return { tiro_secco: [], mercato: [], decina: [], dischetto: [], formazione: [], giramondo: [], asta: [], maglia: [], testa_a_testa: [], bandiere: [], stemma: [], figurina: [] };
}

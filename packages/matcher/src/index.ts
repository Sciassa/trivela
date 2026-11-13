import type { AnswerKey, EntityRecord } from "@trivela/protocol";

type EntityKind = EntityRecord["kind"];

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const SPECIAL: Record<string, string> = {
  ø: "o",
  ł: "l",
  ß: "ss",
  đ: "d",
  ð: "d",
  æ: "ae",
  œ: "oe",
  ı: "i",
  þ: "th",
  ŀ: "l",
};

/** Lowercase, strip diacritics and punctuation, collapse spaces. */
export function normalize(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[øłßđðæœıþŀ]/g, (c) => SPECIAL[c] ?? c);
  s = s.normalize("NFKD").replace(/\p{M}+/gu, "");
  s = s.replace(/['’`´]/g, "");
  s = s.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return s;
}

/** Rough phonetic key tuned for names typed by Italian speakers. */
export function phoneticKey(input: string): string {
  let s = normalize(input).replace(/ /g, "");
  s = s
    .replace(/sch/g, "sk")
    .replace(/ck/g, "k")
    .replace(/ph/g, "f")
    .replace(/qu/g, "kv")
    .replace(/c([aou])/g, "k$1")
    .replace(/ch/g, "k")
    .replace(/gh/g, "g")
    .replace(/cz|ts|tz/g, "c")
    .replace(/sz/g, "s")
    .replace(/[wv]/g, "v")
    .replace(/y/g, "i")
    .replace(/j/g, "i")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1");
  return s;
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function editDistance(a: string, b: string, max = Infinity): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m]!;
}

/** Typo tolerance by length (published rule). */
export function tolerance(length: number): number {
  if (length <= 5) return 1;
  if (length <= 10) return 2;
  return 3;
}

export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  if (len === 0) return 1;
  return 1 - editDistance(a, b) / len;
}

/* ------------------------------------------------------------------ */
/* Global index                                                        */
/* ------------------------------------------------------------------ */

type KeyType = "full" | "alias" | "surname" | "given";

const GIVEN_MIN_LENGTH = 5;
const GIVEN_MAX_PEOPLE = 8;

interface IndexKey {
  key: string;
  phon: string;
  entity: number;
  type: KeyType;
}

export interface MatchIndex {
  entities: EntityRecord[];
  keys: IndexKey[];
  byLength: Map<number, IndexKey[]>;
  /**
   * First names of people, used only by the spelling helper (never to judge an
   * answer: a first name alone is not an answer). Only rare first names are kept,
   * so a typed first name points to a handful of people at most.
   */
  givenByLength: Map<number, IndexKey[]>;
  byId: Map<string, number>;
  /** Fame above which a shared surname makes the surname alone ambiguous. */
  fameThreshold: number;
}

export function buildIndex(entities: EntityRecord[], fameThreshold = 45): MatchIndex {
  const keys: IndexKey[] = [];
  const byId = new Map<string, number>();
  entities.forEach((e, i) => {
    byId.set(e.id, i);
    const seen = new Set<string>();
    const add = (raw: string | undefined, type: KeyType) => {
      if (!raw) return;
      const key = normalize(raw);
      if (!key || seen.has(key)) return;
      seen.add(key);
      keys.push({ key, phon: phoneticKey(key), entity: i, type });
    };
    add(e.name, "full");
    e.aliases.forEach((a) => add(a, "alias"));
    if (e.kind === "person") {
      add(e.family, "surname");
      if (!e.family) {
        const parts = normalize(e.name).split(" ");
        if (parts.length > 1) add(parts[parts.length - 1], "surname");
      }
    }
  });
  const byLength = new Map<number, IndexKey[]>();
  for (const k of keys) {
    const list = byLength.get(k.key.length) ?? [];
    list.push(k);
    byLength.set(k.key.length, list);
  }
  // first names: "lautaro" -> Lautaro Giannetti, Lautaro Martínez, Lautaro Valenti
  const givens = new Map<string, IndexKey[]>();
  entities.forEach((e, i) => {
    if (e.kind !== "person") return;
    const parts = normalize(e.name).split(" ");
    const given = parts[0] ?? "";
    if (parts.length < 2 || given.length < GIVEN_MIN_LENGTH) return;
    const list = givens.get(given) ?? [];
    list.push({ key: given, phon: phoneticKey(given), entity: i, type: "given" });
    givens.set(given, list);
  });
  const givenByLength = new Map<number, IndexKey[]>();
  for (const [given, list] of givens) {
    if (list.length > GIVEN_MAX_PEOPLE) continue; // "marco", "luca": too common to point anywhere
    const bucket = givenByLength.get(given.length) ?? [];
    bucket.push(...list);
    givenByLength.set(given.length, bucket);
  }
  return { entities, keys, byLength, givenByLength, byId, fameThreshold };
}

export type ResolveResult =
  | { status: "ok"; id: string; name: string; ids?: string[] }
  | { status: "ambiguous_surname" }
  | { status: "none" };

/**
 * Resolve typed text to a single entity of the given kinds using the whole
 * global index. The result depends only on (text, index, kinds).
 */
export function resolve(text: string, index: MatchIndex, kinds?: EntityKind[]): ResolveResult {
  const q = normalize(text);
  if (q.length < 2) return { status: "none" };
  const qPhon = phoneticKey(q);
  const tol = tolerance(q.length);
  let best = Infinity;
  let hits: IndexKey[] = [];
  for (let len = q.length - tol; len <= q.length + tol; len++) {
    for (const k of index.byLength.get(len) ?? []) {
      const ent = index.entities[k.entity]!;
      if (kinds && !kinds.includes(ent.kind)) continue;
      let d = editDistance(q, k.key, tol);
      if (d > 0 && k.phon === qPhon) d = Math.min(d, 1);
      if (d > Math.min(tol, tolerance(k.key.length))) continue;
      if (d < best) {
        best = d;
        hits = [k];
      } else if (d === best) {
        hits.push(k);
      }
    }
  }
  if (hits.length === 0) return { status: "none" };
  const ids = new Set(hits.map((h) => h.entity));
  if (ids.size === 1) {
    const ent = index.entities[hits[0]!.entity]!;
    return { status: "ok", id: ent.id, name: ent.name };
  }
  // Several entities at the same distance: if all hits are surnames, keep only
  // famous candidates; a single famous one wins, otherwise the first name is needed.
  const onlySurnames = hits.every((h) => h.type === "surname");
  if (onlySurnames) {
    const famous = [...ids].filter((i) => index.entities[i]!.fame >= index.fameThreshold);
    if (famous.length === 1) {
      const ent = index.entities[famous[0]!]!;
      return { status: "ok", id: ent.id, name: ent.name };
    }
    return { status: "ambiguous_surname" };
  }
  // Prefer full-name/alias hits over surname hits.
  const strong = new Set(hits.filter((h) => h.type !== "surname").map((h) => h.entity));
  if (strong.size === 1) {
    const ent = index.entities[[...strong][0]!]!;
    return { status: "ok", id: ent.id, name: ent.name };
  }
  if (strong.size > 1) {
    // Several people share exactly the same name (e.g. a player and a manager): the text cannot say more.
    const list = [...strong].map((i) => index.entities[i]!).sort((a, b) => b.fame - a.fame);
    return { status: "ok", id: list[0]!.id, name: list[0]!.name, ids: list.map((e) => e.id) };
  }
  return { status: "ambiguous_surname" };
}

/* ------------------------------------------------------------------ */
/* Judging                                                             */
/* ------------------------------------------------------------------ */

export function judgeText(text: string, key: AnswerKey, index: MatchIndex): boolean {
  const q = normalize(text);
  if (!q) return false;
  switch (key.kind) {
    case "number":
      return Number(q.replace(/ /g, "")) === key.value;
    case "text":
      return [key.display, ...key.accepted].some((a) => {
        const n = normalize(a);
        return editDistance(q, n, tolerance(n.length)) <= tolerance(n.length);
      });
    case "entity": {
      const known = key.ids.some((id) => index.byId.has(id));
      if (known) {
        const kinds = key.ids
          .map((id) => index.entities[index.byId.get(id) ?? -1]?.kind)
          .filter((k): k is EntityKind => !!k);
        const r = resolve(text, index, kinds);
        return r.status === "ok" && (r.ids ?? [r.id]).some((id) => key.ids.includes(id));
      }
      const n = normalize(key.display);
      return editDistance(q, n, tolerance(n.length)) <= tolerance(n.length);
    }
  }
}

/** Resolve a typed answer against a closed set of entity ids (lists). */
export function judgeInSet(
  text: string,
  members: { id: string; name: string }[],
  index: MatchIndex,
): { id: string; name: string } | null {
  for (const m of members) {
    if (judgeText(text, { kind: "entity", ids: [m.id], display: m.name }, index)) return m;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Spelling helper: zero information by construction                   */
/* ------------------------------------------------------------------ */

export interface Suggestion {
  name: string;
  score: number;
}

/** Slips tolerated by the corrector: tighter than for judging an answer, so that it does not suggest look-alikes. */
export function suggestTolerance(length: number): number {
  if (length <= 9) return 1;
  if (length <= 13) return 2;
  return 3;
}

export const SPELLER_MIN_COVERAGE = 0.8;
export const SPELLER_MIN_LENGTH = 4;
export const SPELLER_MAX = 8;

/**
 * Corrector, not a completer. It is a pure function of the typed text and the
 * global index: it never receives the question, the game, the context or the
 * year filter, and it never looks at fame. A suggestion appears only when the
 * input already covers most of a name (length >= 80% of it, at least 4 letters)
 * and is a typo of it, in one of two ways:
 *   - spelling: an edit distance (Damerau-Levenshtein) within a
 *     tolerance that grows with the name's length (1 slip up to 9 letters, 2 up to 13, 3 beyond);
 *   - sound: the same phonetic key ("sczesni" and "szczesny" sound alike),
 *     with one more slip allowed on long names.
 * Short names (5 letters or less) must be typed in full: "ross" never suggests
 * "Rossi". Names are a whole surname, a whole (rare) first name, or the full
 * name. Never a prefix: "laut" suggests nothing, "lautaro" suggests the people
 * called Lautaro. Results are ordered by closeness, then alphabetically.
 */
export function suggest(text: string, index: MatchIndex): Suggestion[] {
  const q = normalize(text);
  if (q.length < SPELLER_MIN_LENGTH) return [];
  const qPhon = phoneticKey(q);
  const maxLen = Math.floor(q.length / SPELLER_MIN_COVERAGE);
  const out = new Map<number, number>();
  for (let len = Math.ceil(q.length * SPELLER_MIN_COVERAGE); len <= maxLen; len++) {
    for (const k of [...(index.byLength.get(len) ?? []), ...(index.givenByLength.get(len) ?? [])]) {
      if (k.key.length <= 5 && q.length < k.key.length) continue;
      const tol = suggestTolerance(k.key.length);
      const spelling = editDistance(q, k.key, tol);
      const sound = k.phon.length >= 4 ? editDistance(qPhon, k.phon, k.phon.length >= 7 ? 1 : 0) : Infinity;
      const soundOk = sound <= (k.phon.length >= 7 ? 1 : 0);
      if (spelling > tol && !soundOk) continue;
      // closeness in [0, 1]: the better of the two readings
      const dist = Math.min(spelling <= tol ? spelling : Infinity, soundOk ? sound : Infinity);
      const score = 1 - dist / Math.max(q.length, k.key.length);
      const prev = out.get(k.entity) ?? 0;
      if (score > prev) out.set(k.entity, score);
    }
  }
  return [...out.entries()]
    .map(([i, score]) => ({ name: index.entities[i]!.name, score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "it"))
    .filter((s, i, arr) => arr.findIndex((o) => o.name === s.name) === i)
    .slice(0, SPELLER_MAX);
}

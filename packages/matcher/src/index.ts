import type { AnswerKey, EntityKind, EntityRecord } from "@trivela/protocol";

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

type KeyType = "full" | "alias" | "surname";

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
  byId: Map<string, number>;
  /** Fame above which a shared surname makes the surname alone ambiguous. */
  fameThreshold: number;
}

export function buildIndex(entities: EntityRecord[], fameThreshold = 10): MatchIndex {
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
  return { entities, keys, byLength, byId, fameThreshold };
}

export type ResolveResult =
  | { status: "ok"; id: string; name: string }
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
        return r.status === "ok" && key.ids.includes(r.id);
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

export const SPELLER_MIN_COVERAGE = 0.8;
export const SPELLER_MIN_SIMILARITY = 0.85;
export const SPELLER_MAX = 5;

/**
 * Corrector, not a completer. It is a pure function of the typed text and the
 * global index: it never receives the question, the game, the context or the
 * year filter. A suggestion appears only when the input already covers most of
 * a name (length >= 80%) and is very similar to it (>= 0.85).
 */
export function suggest(text: string, index: MatchIndex): Suggestion[] {
  const q = normalize(text);
  if (q.length < 3) return [];
  const maxLen = Math.floor(q.length / SPELLER_MIN_COVERAGE);
  const out = new Map<number, number>();
  for (let len = Math.ceil(q.length * SPELLER_MIN_COVERAGE); len <= maxLen; len++) {
    for (const k of index.byLength.get(len) ?? []) {
      const sim = similarity(q, k.key);
      if (sim < SPELLER_MIN_SIMILARITY) continue;
      const prev = out.get(k.entity) ?? 0;
      if (sim > prev) out.set(k.entity, sim);
    }
  }
  return [...out.entries()]
    .map(([i, score]) => ({ name: index.entities[i]!.name, score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "it"))
    .filter((s, i, arr) => arr.findIndex((o) => o.name === s.name) === i)
    .slice(0, SPELLER_MAX);
}

/* ------------------------------------------------------------------ */
/* Geo                                                                 */
/* ------------------------------------------------------------------ */

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

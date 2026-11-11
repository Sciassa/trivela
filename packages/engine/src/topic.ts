import type { EntityKind, EntityRecord, InstanceMeta, TopicGraph } from "@trivela/protocol";
import { normalize, resolve, type MatchIndex } from "@trivela/matcher";
import type { TopicResolution } from "./types";

const STOP = new Set([
  "il", "lo", "la", "i", "gli", "le", "l", "un", "una", "uno", "di", "del", "dello", "della", "dei", "degli",
  "delle", "da", "dal", "dalla", "in", "nel", "nella", "nei", "con", "e", "ed", "a", "al", "alla", "ai", "per",
  "su", "tra", "fra", "the", "of", "anni", "anno", "stagione", "calcio", "squadra", "epoca", "era",
]);

const TOPIC_KINDS: EntityKind[] = ["club", "nation", "competition", "edition", "person", "city"];

/** Extract year ranges: "2011/12", "2011-2012", "anni 2000", "anni '90", "1990". */
export function parseYears(raw: string): [number, number] | null {
  const t = raw.toLowerCase();
  const season = t.match(/\b((?:19|20)\d{2})\s*[/-]\s*(\d{4}|\d{2})\b/);
  if (season) {
    const y = Number(season[1]);
    return [y, y];
  }
  const decade = t.match(/anni\s*['’]?\s*(\d{4}|\d{2})/);
  if (decade) {
    let d = Number(decade[1]);
    if (d < 100) d += d >= 30 ? 1900 : 2000;
    return [d, d + 9];
  }
  const years = [...t.matchAll(/\b(18[6-9]\d|19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
  if (years.length === 1) return [years[0]!, years[0]!];
  if (years.length >= 2) return [Math.min(...years), Math.max(...years)];
  return null;
}

/**
 * Deterministic interpretation of a free topic. No list, no menu: the text is
 * mapped to entities of the global index through n-grams.
 */
export function parseTopic(text: string, index: MatchIndex): TopicResolution {
  const years = parseYears(text);
  const cleaned = normalize(text.replace(/\b(18|19|20)\d{2}\s*[/-]\s*\d{2,4}\b/g, " ").replace(/anni\s*['’]?\s*\d{2,4}/gi, " "));
  const tokens = cleaned.split(" ").filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));
  const seeds: string[] = [];
  const names: string[] = [];
  const used = new Array<boolean>(tokens.length).fill(false);
  for (let n = Math.min(4, tokens.length); n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const gram = tokens.slice(i, i + n).join(" ");
      if (gram.length < 3) continue;
      const r = resolve(gram, index, TOPIC_KINDS);
      if (r.status === "ok") {
        if (!seeds.includes(r.id)) {
          seeds.push(r.id);
          names.push(r.name);
        }
        for (let k = i; k < i + n; k++) used[k] = true;
      }
    }
  }
  // Competition + years => also the matching editions.
  if (years) {
    for (const id of [...seeds]) {
      const e = index.entities[index.byId.get(id) ?? -1];
      if (e?.kind !== "competition") continue;
      for (const ed of index.entities) {
        if (ed.kind === "edition" && ed.id.startsWith(`${id}:`) && ed.years?.some((y) => y >= years[0] && y <= years[1])) {
          if (!seeds.includes(ed.id)) {
            seeds.push(ed.id);
            names.push(ed.name);
          }
        }
      }
    }
  }
  const yearLabel = years ? (years[0] === years[1] ? `${years[0]}` : `${years[0]}–${years[1]}`) : "";
  const summary = [...names, yearLabel].filter(Boolean).join(" · ");
  if (seeds.length === 0 && !years) {
    return { text, status: "unknown", summary: "", seeds: [], years: null };
  }
  return { text, status: "ok", summary, seeds, years };
}

const overlapsYears = (it: InstanceMeta, years: [number, number] | null) =>
  !years || (it.yearMax >= years[0] && it.yearMin <= years[1]);

/**
 * Rank items for a topic: level 0 (direct entities), level 1 (neighbours),
 * level 2 (neighbours of neighbours). Returns candidates in order and whether
 * the pool had to be broadened beyond level 2.
 */
export function rankByTopic<T extends InstanceMeta>(
  items: T[],
  topic: TopicResolution,
  graph: TopicGraph,
  shuffle: (a: T[]) => T[],
): { candidates: T[]; levels: number[] } {
  const seeds = new Set(topic.seeds);
  const n1 = new Set<string>();
  for (const s of seeds) for (const n of graph.neighbors[s] ?? []) if (!seeds.has(n)) n1.add(n);
  const n2 = new Set<string>();
  for (const s of n1) for (const n of graph.neighbors[s] ?? []) if (!seeds.has(n) && !n1.has(n)) n2.add(n);
  const hit = (it: T, set: Set<string>) => it.entities.some((e) => set.has(e));
  const taken = new Set<string>();
  const out: T[] = [];
  const levels: number[] = [];
  const push = (list: T[], level: number) => {
    for (const it of shuffle(list)) {
      if (taken.has(it.id)) continue;
      taken.add(it.id);
      out.push(it);
      levels.push(level);
    }
  };
  const l0 = items.filter((it) => (seeds.size ? hit(it, seeds) : true) && overlapsYears(it, topic.years));
  push(l0, 0);
  push(items.filter((it) => hit(it, n1) && overlapsYears(it, topic.years)), 1);
  push(items.filter((it) => hit(it, n1) || hit(it, n2)), 2);
  push(items, 3);
  return { candidates: out, levels };
}

export function describeEntities(ids: string[], entities: EntityRecord[]): string {
  const byId = new Map(entities.map((e) => [e.id, e.name]));
  return ids.map((id) => byId.get(id) ?? id).join(" · ");
}

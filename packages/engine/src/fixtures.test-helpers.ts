/* Synthetic fixtures for engine tests only (never shipped as content). */
import { emptyPackItems, type EntityRecord, type InstanceMeta, type Packs } from "@trivela/protocol";
import { buildIndex } from "@trivela/matcher";
import type { EngineCtx } from "./types";

export const SURNAMES = [
  "Abete", "Betulla", "Cedro", "Faggio", "Gelso", "Larice", "Mirto", "Quercia", "Rovere", "Salice",
  "Ulivo", "Visciolo", "Zagara", "Carpino", "Ontano", "Platano", "Tamerice", "Ginepro", "Corbezzolo", "Sughera",
];

export const people: EntityRecord[] = SURNAMES.map((s, i) => ({
  id: `p${i}`,
  kind: "person",
  name: `Mario ${s}`,
  family: s,
  aliases: [],
  fame: 20,
  years: [2000 + i],
}));

const clubs: EntityRecord[] = [
  { id: "c1", kind: "club", name: "Juventus", aliases: ["Juve"], fame: 90 },
  { id: "c2", kind: "club", name: "Udinese", aliases: [], fame: 50 },
  { id: "x1", kind: "competition", name: "Serie A", aliases: [], fame: 90 },
];

export const P = (i: number) => ({ id: `p${i}`, name: `Mario ${SURNAMES[i]}` });

let seq = 0;
export function meta(over: Partial<InstanceMeta> = {}): InstanceMeta {
  seq += 1;
  return {
    id: `i${seq}`,
    generator: "test",
    yearMin: 2010,
    yearMax: 2010,
    difficulty: 2,
    fame: 10,
    entities: [],
    sources: [
      { family: "a", label: "A", url: "https://a.example" },
      { family: "b", label: "B", url: "https://b.example" },
    ],
    script: "copione",
    ...over,
  };
}

export function makePacks(): Packs {
  const items = emptyPackItems();
  for (let k = 0; k < 20; k++) {
    items.tiro_secco.push({ ...meta({ yearMin: 1990 + k, yearMax: 1990 + k }), question: `Q${k}`, options: ["a", "b", "c", "d"], correct: 1, archetype: 1 });
    items.maglia.push({ ...meta({ yearMin: 1995 + k }), team: "Juventus", season: "2010/11", number: 10, answer: { kind: "entity", ids: [P(k).id], display: P(k).name } });
    items.mappamondo.push({ ...meta(), question: `Dove ${k}?`, target: { lat: 45.07, lon: 7.69, label: "Torino" } });
    items.frame.push({ ...meta(), match: "A-B", date: "2010-01-01", minute: 30, teams: ["A", "B"], scoreAt: [2, 1], lastScorer: { kind: "entity", ids: ["p1"], display: P(1).name } });
    items.intruso.push({ ...meta({ activeYears: [2001, 2005, 2008, 2012] }), names: ["a", "b", "c", "d"], intruder: 2, links: ["l0", "l1", "l2", "l3"], correctLink: 3 });
    items.cassaforte.push({ ...meta({ entities: k % 2 ? ["c1"] : ["c2"] }), level: ((k % 3) + 1) as 1 | 2 | 3, question: `C${k}`, parts: [{ kind: "entity", ids: [P(k).id], display: P(k).name }] });
    items.prima_pagina.push({
      ...meta({ entities: k % 2 ? ["c1"] : ["c2"] }),
      page: { masthead: "La Trivela Sportiva", date: "2010-01-01", weekday: "venerdì", kicker: "k", headline: "{{0}} decide", subhead: "s", body: ["{{1}} in porta"], boxTitle: "Tabellino", boxLines: [] },
      slots: [
        { label: "Marcatore", answer: { kind: "entity", ids: ["p2"], display: P(2).name }, lengthBucket: 2 },
        { label: "Portiere", answer: { kind: "entity", ids: ["p3"], display: P(3).name }, lengthBucket: 2 },
      ],
    });
  }
  for (let k = 0; k < 4; k++) {
    items.mercato.push({ ...meta(), clues: ["10 mln €", "Estate 2010", "Attaccante", "Italia", "Dal Cedro FC", "Alla Juventus"], answer: { kind: "entity", ids: [P(k).id], display: P(k).name } });
    items.giramondo.push({ ...meta({ activeYears: [2015] }), clues: ["c1", "c2", "c3", "c4", "c5"], answer: { kind: "entity", ids: [P(k).id], display: P(k).name } });
    items.decina.push({ ...meta(), title: "Insieme", description: "d", members: Array.from({ length: 15 }, (_, i) => P(i)) });
    items.asta.push({ ...meta(), title: "Asta", description: "d", members: Array.from({ length: 12 }, (_, i) => P(i)) });
    items.dischetto.push({
      ...meta(),
      title: "Top",
      definition: "def",
      unit: "gol",
      ranking: [
        ...Array.from({ length: 9 }, (_, i) => ({ rank: i + 1, ...P(i), value: 50 - i })),
        { rank: 10, ...P(9), value: 20 },
        { rank: 10, ...P(10), value: 20 },
        { rank: 12, ...P(11), value: 19 },
      ],
    });
    items.formazione.push({
      ...meta(),
      title: "A-B",
      date: "2010-01-01",
      competition: "Serie A",
      teams: [0, 1].map((t) => ({
        id: `t${t}`,
        name: `T${t}`,
        formation: "4-4-2",
        players: Array.from({ length: 11 }, (_, i) => ({ ...P((i + t * 9) % 20), x: 0.5, y: 0.5, hidden: i < 5 })),
      })) as never,
    });
    items.filo_rosso.push({ ...meta({ activeYears: [2010, 2012] }), from: P(0), to: P(3), optimal: 2, solution: [P(0), P(1), P(3)] });
  }
  return {
    manifest: { version: "test", generatedAt: "", snapshot: "", counts: {}, sources: [] },
    items,
    entities: [...people, ...clubs],
    teammates: {
      groups: { g1: { label: "g1", members: ["p0", "p1"] }, g2: { label: "g2", members: ["p1", "p3"] }, g3: { label: "g3", members: ["p0", "p2"] }, g4: { label: "g4", members: ["p2", "p4"] }, g5: { label: "g5", members: ["p4", "p3"] } },
      byPerson: { p0: ["g1", "g3"], p1: ["g1", "g2"], p2: ["g3", "g4"], p3: ["g2", "g5"], p4: ["g4", "g5"] },
    },
    topics: { neighbors: { c1: ["x1"], x1: ["c1", "c2"], c2: ["x1"] } },
  };
}

export function makeCtx(packs: Packs): EngineCtx {
  return { index: buildIndex(packs.entities), teammates: packs.teammates };
}

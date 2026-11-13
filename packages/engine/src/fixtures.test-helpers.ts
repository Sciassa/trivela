/* Synthetic fixtures for engine tests only (never shipped as content). */
import { emptyPackItems, type EntityRecord, type InstanceMeta, type Packs } from "@trivela/protocol";
import { buildIndex } from "@trivela/matcher";
import type { EngineCtx } from "./types";

export const SURNAMES = [
  "Abete", "Betulla", "Cedro", "Faggio", "Gelso", "Larice", "Mirto", "Quercia", "Rovere", "Salice",
  "Ulivo", "Visciolo", "Zagara", "Carpino", "Ontano", "Platano", "Tamerice", "Ginepro", "Corbezzolo", "Sughera",
];

export const people: EntityRecord[] = SURNAMES.map((s, i) => ({ id: `p${i}`, kind: "person", name: `Mario ${s}`, family: s, aliases: [], fame: 60 }));
export const P = (i: number) => ({ id: `p${i}`, name: `Mario ${SURNAMES[i]}` });

let seq = 0;
export function meta(over: Partial<InstanceMeta> = {}): InstanceMeta {
  seq += 1;
  return {
    id: `i${seq}`,
    generator: `gen${seq % 3}`,
    yearMin: 2015,
    yearMax: 2015,
    difficulty: 2,
    fame: 10,
    entities: [],
    sources: [{ family: "a", label: "A", url: "https://a.example" }],
    script: "copione",
    ...over,
  };
}

export function makePacks(): Packs {
  const items = emptyPackItems();
  for (let k = 0; k < 20; k++) {
    items.tiro_secco.push({ ...meta({ yearMin: 2005 + k, yearMax: 2005 + k }), question: `Q${k}`, options: ["a", "b", "c", "d"], correct: 1, archetype: 1 });
    items.maglia.push({ ...meta({ yearMin: 2010 + k }), player: P(k).name, team: "Juventus", season: "Serie A 2015/16", question: "Che numero?", answer: { kind: "number", value: 10 + k, display: String(10 + k) } });
    items.anomalia.push({ ...meta(), question: `Anomalia ${k}?`, options: ["a", "b", "c", "d"], correct: 3, kind: "difensore" });
  }
  for (let k = 0; k < 6; k++) {
    items.mercato.push({ ...meta(), clues: ["10 mln €", "Estate 2015", "Attaccante", "Italia", "Dal Cedro FC", "Alla Juventus"], answer: { kind: "entity", ids: [P(k).id], display: P(k).name } });
    items.giramondo.push({ ...meta({ activeYears: [2020] }), clues: ["c1", "c2", "c3", "c4", "c5"], answer: { kind: "entity", ids: [P(k).id], display: P(k).name } });
    items.decina.push({ ...meta(), title: "Insieme", description: "d", members: Array.from({ length: 15 }, (_, i) => P(i)) });
    items.asta.push({ ...meta(), title: "Asta", description: "d", members: Array.from({ length: 12 }, (_, i) => P(i)) });
    items.dischetto.push({
      ...meta(),
      title: "Top",
      definition: "def",
      unit: "gol",
      hint: "Il 1° ha 50 gol, il 10° ne ha 20.",
      ranking: [
        ...Array.from({ length: 9 }, (_, i) => ({ rank: i + 1, ...P(i), value: 50 - i })),
        { rank: 10, ...P(9), value: 20 },
        { rank: 10, ...P(10), value: 20 },
      ],
    });
    items.formazione.push({
      ...meta(),
      title: "A-B",
      date: "2015-01-01",
      competition: "Serie A",
      teams: [0, 1].map((t) => ({
        id: `t${t}`,
        name: `T${t}`,
        formation: "4-4-2",
        players: Array.from({ length: 11 }, (_, i) => ({ ...P((i + t * 9) % 20), x: 0.5, y: 0.5, hidden: i < 5 })),
      })) as never,
    });
  }
  return { manifest: { version: "test", generatedAt: "", snapshot: "", counts: {}, sources: [] }, items, entities: people };
}

export function makeCtx(packs: Packs): EngineCtx {
  return { index: buildIndex(packs.entities) };
}

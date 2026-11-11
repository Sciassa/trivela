import { emptyPackItems, GAME_IDS, type GameId, type PackItems, type Packs } from "@trivela/protocol";
import { buildIndex } from "@trivela/matcher";
import type { EngineCtx } from "@trivela/engine";

let cached: Promise<{ packs: Packs; ctx: EngineCtx }> | null = null;

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`./packs/${path}`);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export function loadPacks(): Promise<{ packs: Packs; ctx: EngineCtx }> {
  if (!cached) {
    cached = (async () => {
      const manifest = await getJson<Packs["manifest"]>("manifest.json", {
        version: "empty",
        generatedAt: "",
        snapshot: "",
        counts: {},
        sources: [],
      });
      const items = emptyPackItems();
      await Promise.all(
        GAME_IDS.map(async (g: GameId) => {
          (items as Record<GameId, unknown[]>)[g] = await getJson<unknown[]>(`${g}.json`, []);
        }),
      );
      const entities = await getJson<Packs["entities"]>("entities.json", []);
      const teammates = await getJson<Packs["teammates"]>("teammates.json", { groups: {}, byPerson: {} });
      const topics = await getJson<Packs["topics"]>("topics.json", { neighbors: {} });
      const packs: Packs = { manifest, items: items as PackItems, entities, teammates, topics };
      return { packs, ctx: { index: buildIndex(entities), teammates } };
    })();
  }
  return cached;
}

/** Device history of seen instances (per-viewer convenience, safe if storage fails). */
export function seenIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem("trivela.seen") ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function rememberSeen(ids: string[]): void {
  try {
    const all = Array.from(new Set([...seenIds(), ...ids])).slice(-5000);
    localStorage.setItem("trivela.seen", JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

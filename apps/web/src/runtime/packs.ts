import { emptyPackItems, type GameId, type PackItems, type Packs, type PoolGameId } from "@trivela/protocol";
import { buildIndex } from "@trivela/matcher";
import { createMatch, drawGames, MODULES, POOL, Rng, type EngineCtx, type MatchConfig, type MatchState } from "@trivela/engine";

/**
 * Lazy data loading (SPEC §0.4):
 *  - core (manifest + entity index + topic graph) is loaded only by the device that runs the match;
 *  - each game pack (data/games/<id>.json) is fetched only when that game is drawn;
 *  - Regia and controllers never download packs.
 */

const BASE = "./data";

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${BASE}/${path}`);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export interface Core {
  packs: Packs;
  ctx: EngineCtx;
}

let core: Promise<Core> | null = null;
const gameCache = new Map<GameId, Promise<unknown[]>>();
let teammates: Promise<Packs["teammates"]> | null = null;

export function loadCore(): Promise<Core> {
  if (!core) {
    core = (async () => {
      const [manifest, entities, topics] = await Promise.all([
        getJson<Packs["manifest"]>("manifest.json", { version: "empty", generatedAt: "", snapshot: "", counts: {}, sources: [] }),
        getJson<Packs["entities"]>("entities.json", []),
        getJson<Packs["topics"]>("topics.json", { neighbors: {} }),
      ]);
      const packs: Packs = { manifest, items: emptyPackItems(), entities, teammates: { groups: {}, byPerson: {} }, topics };
      return { packs, ctx: { index: buildIndex(entities), teammates: packs.teammates } };
    })();
  }
  return core;
}

/** Empty context for phones (no index download: the server judges the answers). */
export const emptyCtx: EngineCtx = { index: buildIndex([]), teammates: { groups: {}, byPerson: {} } };

function loadGame(g: GameId): Promise<unknown[]> {
  if (!gameCache.has(g)) gameCache.set(g, getJson<unknown[]>(`games/${g}.json`, []));
  return gameCache.get(g)!;
}

async function ensureGames(c: Core, games: GameId[]): Promise<void> {
  await Promise.all(
    games.map(async (g) => {
      (c.packs.items as Record<GameId, unknown[]>)[g] = await loadGame(g);
    }),
  );
  if (games.includes("filo_rosso")) {
    teammates ??= getJson<Packs["teammates"]>("teammates.json", { groups: {}, byPerson: {} });
    const tm = await teammates;
    c.packs.teammates = tm;
    c.ctx = { ...c.ctx, teammates: tm };
  }
}

/** Draw the games from the manifest, download only those packs, then create the match. */
export async function prepareMatch(
  config: Omit<MatchConfig, "forcedGames">,
): Promise<{ ok: true; state: MatchState; ctx: EngineCtx } | { ok: false; reason: string }> {
  const c = await loadCore();
  const counts = c.packs.manifest.counts;
  const forced = (config as MatchConfig & { forcedGames?: PoolGameId[] }).forcedGames;
  let available = POOL.filter((g) => (counts[g] ?? 0) >= (g === "prima_pagina" ? 2 : MODULES[g].count));
  const rng = new Rng(config.seed ^ 0x5eed);
  let lastReason = "Contenuti insufficienti.";
  for (let attempt = 0; attempt < 8; attempt++) {
    const games = forced ?? drawGames(rng, available);
    if (games.length < 4) break;
    await ensureGames(c, [...games, "cassaforte"]);
    const r = createMatch({ ...config, forcedGames: games }, c.packs, c.ctx);
    if (r.ok) return { ok: true, state: r.state, ctx: c.ctx };
    lastReason = r.reason;
    if (r.reason.startsWith("Argomento") || forced) return r;
    const bad = games.find((g) => r.reason.includes(g) || r.reason.toLowerCase().includes(g.replace("_", " ")));
    available = available.filter((g) => g !== (bad ?? games[games.length - 1]));
  }
  return { ok: false, reason: lastReason };
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

export type { PackItems };

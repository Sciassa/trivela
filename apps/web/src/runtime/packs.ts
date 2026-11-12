import { emptyPackItems, type GameId, type Packs } from "@trivela/protocol";
import { buildIndex } from "@trivela/matcher";
import { createMatch, drawGames, GAMES_PER_MATCH, itemsNeeded, POOL, Rng, type EngineCtx, type MatchConfig, type MatchState } from "@trivela/engine";

/**
 * Lazy data loading (SPEC §0.4):
 *  - the core (manifest + people index) is loaded only by the device that runs the match;
 *  - each game pack (data/games/<id>.json) is fetched only when that game is drawn;
 *  - Regia and controllers never download game data.
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

export function loadCore(): Promise<Core> {
  if (!core) {
    core = (async () => {
      const [manifest, entities] = await Promise.all([
        getJson<Packs["manifest"]>("manifest.json", { version: "empty", generatedAt: "", snapshot: "", counts: {}, sources: [] }),
        getJson<Packs["entities"]>("entities.json", []),
      ]);
      const packs: Packs = { manifest, items: emptyPackItems(), entities };
      return { packs, ctx: { index: buildIndex(entities) } };
    })();
  }
  return core;
}

/** Empty context for phones: no index download, the Screen device judges the answers. */
export const emptyCtx: EngineCtx = { index: buildIndex([]) };

function loadGame(g: GameId): Promise<unknown[]> {
  if (!gameCache.has(g)) gameCache.set(g, getJson<unknown[]>(`games/${g}.json`, []));
  return gameCache.get(g)!;
}

export type PrepareResult = { ok: true; state: MatchState; ctx: EngineCtx } | { ok: false; reason: string };

/** Draw the games from the manifest, download only those packs, then create the match. */
export async function prepareMatch(config: MatchConfig): Promise<PrepareResult> {
  const c = await loadCore();
  const counts = c.packs.manifest.counts;
  let available = POOL.filter((g) => (counts[g] ?? 0) >= itemsNeeded(g));
  const rng = new Rng(config.seed ^ 0x5eed);
  let lastReason = "Contenuti insufficienti.";
  for (let attempt = 0; attempt < 8; attempt++) {
    const games = config.forcedGames ?? drawGames(rng, available);
    if (games.length < GAMES_PER_MATCH && !config.forcedGames) break;
    await Promise.all(
      games.map(async (g) => {
        (c.packs.items as Record<GameId, unknown[]>)[g] = await loadGame(g);
      }),
    );
    const r = createMatch({ ...config, forcedGames: games }, c.packs);
    if (r.ok) return { ok: true, state: r.state, ctx: c.ctx };
    lastReason = r.reason;
    if (config.forcedGames) break;
    // e.g. the year filter leaves too few questions for one game: draw again without it
    const bad = games.find((g) => r.reason.includes(g));
    available = available.filter((g) => g !== (bad ?? games[games.length - 1]));
  }
  return { ok: false, reason: lastReason };
}

/** Debug aid: ?games=a,b,c,d,e forces the drawn games (used by visual checks). */
export function forcedGamesFromUrl(): GameId[] | undefined {
  const raw = new URLSearchParams(location.search).get("games");
  const list = raw?.split(",").filter((g): g is GameId => (POOL as string[]).includes(g));
  return list?.length ? list : undefined;
}

export function newSeed(): number {
  return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
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
    const all = Array.from(new Set([...seenIds(), ...ids])).slice(-6000);
    localStorage.setItem("trivela.seen", JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Create a match avoiding questions already seen on this device, when possible. */
export async function prepareFreshMatch(config: MatchConfig): Promise<PrepareResult> {
  const r = await prepareMatch({ ...config, excludeIds: [...seenIds(), ...(config.excludeIds ?? [])] });
  return r.ok ? r : prepareMatch(config);
}

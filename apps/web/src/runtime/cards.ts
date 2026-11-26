import type { PlayerCardData } from "@trivela/protocol";

/**
 * Player cards (SPEC §14.3), fetched on demand: 16 small shards (`data/cards/<id % 16>.json`), each at most once.
 * Only the Screen asks for them, and only once the answer is out (a reveal or the end of the match); the phones never.
 */
const SHARDS = 16;
const shards = new Map<number, Promise<Record<string, PlayerCardData>>>();

function shard(n: number): Promise<Record<string, PlayerCardData>> {
  let p = shards.get(n);
  if (!p) {
    p = fetch(`./data/cards/${n}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, PlayerCardData>>) : {}))
      .catch(() => ({}));
    shards.set(n, p);
  }
  return p;
}

/** The card of a player ("tm:p:123"), or null when there is none (no complete league season in the dataset). */
export async function loadCard(entity: string | undefined | null): Promise<PlayerCardData | null> {
  const m = entity?.match(/^tm:p:(\d+)$/);
  if (!m) return null;
  const id = m[1]!;
  return (await shard(Number(id) % SHARDS))[id] ?? null;
}

/** The first player entity of a question, if it is about one or two people (the same rule as the draw). */
export function playerOf(entities: string[] | undefined): string | null {
  const people = (entities ?? []).filter((e) => e.startsWith("tm:p:"));
  return people.length >= 1 && people.length <= 2 ? people[0]! : null;
}

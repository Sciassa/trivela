/**
 * Tournament: league phase with a General Table (summed points, may be
 * negative), then semifinals (1v4, 2v3) and final for the top 4.
 */

export interface TournamentMatch {
  id: string;
  stage: "league" | "semi" | "final";
  round: number;
  a: number;
  b: number;
  scoreA: number | null;
  scoreB: number | null;
}

export interface TournamentState {
  players: string[];
  format: "round_robin" | "swiss";
  rounds: number;
  yearFrom: number | null;
  matches: TournamentMatch[];
  usedIds: string[];
  phase: "league" | "semi" | "final" | "done";
}

export interface Standing {
  player: number;
  name: string;
  played: number;
  points: number;
  average: number;
  wins: number;
  best: number;
}

export function createTournament(players: string[], opts: { rounds?: number; yearFrom?: number | null } = {}): TournamentState {
  if (players.length < 4 || players.length > 12) throw new Error("Da 4 a 12 giocatori");
  const format = players.length <= 6 ? "round_robin" : "swiss";
  const t: TournamentState = {
    players,
    format,
    rounds: format === "round_robin" ? (players.length % 2 === 0 ? players.length - 1 : players.length) : opts.rounds ?? 3,
    yearFrom: opts.yearFrom ?? null,
    matches: [],
    usedIds: [],
    phase: "league",
  };
  if (format === "round_robin") t.matches = roundRobin(players.length);
  else t.matches = swissRound(t, 1);
  return t;
}

/** Circle method; odd counts get a bye (no match). */
export function roundRobin(n: number): TournamentMatch[] {
  const ids = Array.from({ length: n % 2 === 0 ? n : n + 1 }, (_, i) => i);
  const bye = n % 2 === 0 ? -1 : n;
  const out: TournamentMatch[] = [];
  const rounds = ids.length - 1;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < ids.length / 2; i++) {
      const a = ids[i]!;
      const b = ids[ids.length - 1 - i]!;
      if (a !== bye && b !== bye) out.push(newMatch("league", r + 1, a, b));
    }
    ids.splice(1, 0, ids.pop()!);
  }
  return out;
}

function newMatch(stage: TournamentMatch["stage"], round: number, a: number, b: number): TournamentMatch {
  return { id: `${stage}-${round}-${a}-${b}`, stage, round, a, b, scoreA: null, scoreB: null };
}

function played(t: TournamentState, a: number, b: number): boolean {
  return t.matches.some((m) => m.stage === "league" && ((m.a === a && m.b === b) || (m.a === b && m.b === a)));
}

/** Swiss pairing by current table, avoiding rematches when possible. */
export function swissRound(t: TournamentState, round: number): TournamentMatch[] {
  const order = round === 1 ? t.players.map((_, i) => i) : standings(t).map((s) => s.player);
  const free = [...order];
  const out: TournamentMatch[] = [];
  while (free.length > 1) {
    const a = free.shift()!;
    let idx = free.findIndex((b) => !played(t, a, b));
    if (idx === -1) idx = 0;
    const b = free.splice(idx, 1)[0]!;
    out.push(newMatch("league", round, a, b));
  }
  return out;
}

export function recordResult(
  t: TournamentState,
  matchId: string,
  scoreA: number,
  scoreB: number,
  extra: { usedIds?: string[] } = {},
): TournamentState {
  const next: TournamentState = structuredClone(t);
  const m = next.matches.find((x) => x.id === matchId);
  if (!m) throw new Error("Partita inesistente");
  m.scoreA = scoreA;
  m.scoreB = scoreB;
  next.usedIds.push(...(extra.usedIds ?? []));
  return advance(next);
}

function advance(t: TournamentState): TournamentState {
  const pending = (stage: TournamentMatch["stage"]) => t.matches.some((m) => m.stage === stage && m.scoreA === null);
  if (t.phase === "league" && !pending("league")) {
    const lastRound = Math.max(...t.matches.filter((m) => m.stage === "league").map((m) => m.round));
    if (t.format === "swiss" && lastRound < t.rounds) {
      t.matches.push(...swissRound(t, lastRound + 1));
      return t;
    }
    const top = standings(t).slice(0, 4).map((s) => s.player);
    t.matches.push(newMatch("semi", 1, top[0]!, top[3]!), newMatch("semi", 1, top[1]!, top[2]!));
    t.phase = "semi";
    return t;
  }
  if (t.phase === "semi" && !pending("semi")) {
    const [s1, s2] = t.matches.filter((m) => m.stage === "semi");
    t.matches.push(newMatch("final", 1, winnerOfMatch(s1!), winnerOfMatch(s2!)));
    t.phase = "final";
    return t;
  }
  if (t.phase === "final" && !pending("final")) t.phase = "done";
  return t;
}

/** Knock-out ties go to the better-placed player of the league phase (listed first). */
export function winnerOfMatch(m: TournamentMatch): number {
  const a = m.scoreA ?? 0;
  const b = m.scoreB ?? 0;
  if (a !== b) return a > b ? m.a : m.b;
  return m.a;
}

export function standings(t: TournamentState): Standing[] {
  const rows: Standing[] = t.players.map((name, player) => ({
    player,
    name,
    played: 0,
    points: 0,
    average: 0,
    wins: 0,
    best: -Infinity,
  }));
  for (const m of t.matches) {
    if (m.stage !== "league" || m.scoreA === null || m.scoreB === null) continue;
    const ra = rows[m.a]!;
    const rb = rows[m.b]!;
    ra.played++;
    rb.played++;
    ra.points += m.scoreA;
    rb.points += m.scoreB;
    ra.best = Math.max(ra.best, m.scoreA);
    rb.best = Math.max(rb.best, m.scoreB);
    if (m.scoreA > m.scoreB) ra.wins++;
    else if (m.scoreB > m.scoreA) rb.wins++;
  }
  const unequal = new Set(rows.map((r) => r.played)).size > 1;
  rows.forEach((r) => {
    r.average = r.played ? r.points / r.played : 0;
    if (r.best === -Infinity) r.best = 0;
  });
  const h2h = (a: number, b: number) => {
    let diff = 0;
    for (const m of t.matches) {
      if (m.stage !== "league" || m.scoreA === null || m.scoreB === null) continue;
      if (m.a === a && m.b === b) diff += m.scoreA - m.scoreB;
      if (m.a === b && m.b === a) diff += m.scoreB - m.scoreA;
    }
    return diff;
  };
  return rows.sort(
    (x, y) =>
      (unequal ? y.average - x.average : y.points - x.points) ||
      y.wins - x.wins ||
      -h2h(x.player, y.player) ||
      y.best - x.best ||
      x.player - y.player,
  );
}

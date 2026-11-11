import type {
  CassaforteItem,
  DischettoItem,
  FiloRossoItem,
  FormazioneItem,
  FrameItem,
  GameId,
  GiramondoItem,
  IntrusoItem,
  MagliaItem,
  MappamondoItem,
  MercatoItem,
  PlayerIdx,
  PrimaPaginaItem,
  Role,
  SetItem,
  TiroSeccoItem,
} from "@trivela/protocol";
import { haversineKm, judgeInSet, judgeText, resolve } from "@trivela/matcher";
import { other, type Env, type GameModule, type GameStateAny, type Intent } from "./types";

/** Default timers (ms). */
export const TIMERS = {
  tiro_secco: 20_000,
  prima_pagina: 45_000,
  ready: 2_000,
  clue: 8_000,
  freeClue: 20_000,
  answer: 10_000,
  list: 30_000,
  feedback: 1_500,
  formazione: 60_000,
  cassaforte: 30_000,
  frame: 30_000,
  intruso: 30_000,
  asta: 60_000,
  filo_rosso: 60_000,
  mappamondo: 30_000,
  maglia: 30_000,
} as const;

const clone = <T>(x: T): T => structuredClone(x);

function playerOf(intent: Intent, s: GameStateAny): PlayerIdx | null {
  if ("player" in intent && intent.player !== undefined) return intent.player;
  return s.turn;
}

/* ------------------------------------------------------------------ */
/* Turn-based quiz factory                                              */
/* ------------------------------------------------------------------ */

interface JudgeResult {
  points: number;
  ok: boolean;
  detail?: string;
}

interface QuizPhase<I> {
  ms: number;
  /** intent === null means time ran out. */
  judge(item: I, intent: Intent | null, env: Env): JudgeResult | "ignore";
}

interface QuizDef<I> {
  id: GameId;
  count: number;
  perPlayer?: boolean;
  phases: QuizPhase<I>[];
  /** Hide the answer of the current, not yet revealed item. */
  mask(item: I): I;
}

function turnOf(i: number, starter: PlayerIdx): PlayerIdx {
  return i % 2 === 0 ? starter : other(starter);
}

function turnQuiz<I extends { script: string }>(def: QuizDef<I>): GameModule {
  const itemAt = (s: GameStateAny): I =>
    (def.perPlayer ? s.items[s.turn as number] : s.items[s.i]) as I;
  const total = (items: unknown[]) => (def.perPlayer ? 2 : items.length);
  return {
    id: def.id,
    count: def.count,
    perPlayer: def.perPlayer,
    init(items, env) {
      env.setTimer(def.phases[0]!.ms, "ask");
      return {
        game: def.id,
        stage: "ask",
        turn: env.starter,
        starter: env.starter,
        items,
        i: 0,
        phase: 0,
        results: [] as JudgeResult[],
        last: null,
        script: null,
      };
    },
    reduce(s, intent, env) {
      if (s.stage === "ask") {
        let input: Intent | null;
        if (intent.type === "TIMEOUT") input = null;
        else if (intent.type === "ANSWER" || intent.type === "VERDICT") {
          const p = playerOf(intent, s);
          if (env.judging === "auto" && p !== s.turn) return;
          input = intent;
        } else return;
        const item = itemAt(s);
        const r = def.phases[s.phase]!.judge(item, input, env);
        if (r === "ignore") return;
        const player = s.turn as PlayerIdx;
        if (r.points !== 0) env.addPoints(player, r.points);
        env.emit(r.ok ? { type: "correct", player, points: r.points } : { type: "wrong", player, points: r.points });
        if (input === null) env.emit({ type: "timeout" });
        s.results.push(r);
        s.last = { player, points: r.points, ok: r.ok, detail: r.detail };
        if (s.phase < def.phases.length - 1) {
          s.phase += 1;
          env.setTimer(def.phases[s.phase]!.ms, "ask");
          return;
        }
        s.stage = "reveal";
        s.script = item.script;
        env.clearTimer();
        env.emit({ type: "reveal" });
        return;
      }
      if (s.stage === "reveal" && intent.type === "NEXT") {
        s.i += 1;
        if (s.i >= total(s.items)) {
          s.stage = "done";
          return;
        }
        s.turn = turnOf(s.i, s.starter);
        s.phase = 0;
        s.results = [];
        s.last = null;
        s.script = null;
        s.stage = "ask";
        env.setTimer(def.phases[0]!.ms, "ask");
      }
    },
    done: (s) => s.stage === "done",
    redact(s, role) {
      if (role === "host") return s;
      const r = clone(s);
      r.items = r.items.map((it: I, idx: number) => {
        const owner = def.perPlayer ? (idx as PlayerIdx) : null;
        const current = def.perPlayer ? owner === s.turn : idx === s.i;
        const past = def.perPlayer
          ? s.i > 0 && owner === s.starter && !current
          : idx < s.i;
        if (past) return it;
        if (current) return s.stage === "reveal" ? it : def.mask(it);
        return null;
      });
      return r;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Game definitions: turn-based                                         */
/* ------------------------------------------------------------------ */

const answerOf = (intent: Intent | null) => (intent && intent.type === "ANSWER" ? intent.payload : undefined);
const verdictOf = (intent: Intent | null) => (intent && intent.type === "VERDICT" ? intent.payload : undefined);

export const tiroSecco = turnQuiz<TiroSeccoItem>({
  id: "tiro_secco",
  count: 8,
  phases: [
    {
      ms: TIMERS.tiro_secco,
      judge(item, intent) {
        if (intent === null) return { points: 0, ok: false, detail: "Tempo scaduto" };
        const a = answerOf(intent);
        if (a?.choice === undefined) return "ignore";
        const ok = a.choice === item.correct;
        return { points: ok ? 2 : 0, ok, detail: `choice:${a.choice}` };
      },
    },
  ],
  mask: (it) => ({ ...it, correct: -1 as never, script: "" }),
});

export const primaPagina = turnQuiz<PrimaPaginaItem>({
  id: "prima_pagina",
  count: 1,
  perPlayer: true,
  phases: [
    {
      ms: TIMERS.prima_pagina,
      judge(item, intent, env) {
        if (intent === null) return { points: 0, ok: false, detail: "Tempo scaduto" };
        let hits: boolean[];
        const v = verdictOf(intent);
        const a = answerOf(intent);
        if (v?.slots) hits = item.slots.map((_, k) => !!v.slots![k]);
        else if (a?.texts) hits = item.slots.map((slot, k) => judgeText(a.texts![k] ?? "", slot.answer, env.ctx.index));
        else return "ignore";
        const n = hits.filter(Boolean).length;
        return { points: n * 2, ok: n > 0, detail: `slots:${hits.map((h) => (h ? 1 : 0)).join("")}` };
      },
    },
  ],
  mask: (it) => ({
    ...it,
    slots: it.slots.map((sl) => ({ ...sl, answer: { kind: "text", accepted: [], display: "" } })) as unknown as PrimaPaginaItem["slots"],
    script: "",
  }),
});

export const frame = turnQuiz<FrameItem>({
  id: "frame",
  count: 4,
  phases: [
    {
      ms: TIMERS.frame,
      judge(item, intent, env) {
        if (intent === null) return { points: 0, ok: false, detail: "Tempo scaduto" };
        const a = answerOf(intent);
        if (!a?.score) return "ignore";
        const [h, w] = a.score;
        const [eh, ew] = item.scoreAt;
        const exact = h === eh && w === ew;
        const sign = Math.sign(h - w) === Math.sign(eh - ew);
        let points = exact ? 3 : sign ? 1 : 0;
        let bonus = false;
        if (item.lastScorer) {
          bonus = a.scorerCorrect ?? (a.scorer ? judgeText(a.scorer, item.lastScorer, env.ctx.index) : false);
          if (bonus) points += 2;
        }
        return { points, ok: points > 0, detail: `exact:${exact ? 1 : 0},sign:${sign ? 1 : 0},bonus:${bonus ? 1 : 0}` };
      },
    },
  ],
  mask: (it) => ({ ...it, scoreAt: [-1, -1], lastScorer: it.lastScorer ? { kind: "text", accepted: [], display: "" } : undefined, script: "" }),
});

export const intruso = turnQuiz<IntrusoItem>({
  id: "intruso",
  count: 6,
  phases: [
    {
      ms: TIMERS.intruso,
      judge(item, intent) {
        if (intent === null) return { points: 0, ok: false, detail: "Tempo scaduto" };
        const a = answerOf(intent);
        if (a?.choice === undefined) return "ignore";
        const ok = a.choice === item.intruder;
        return { points: ok ? 3 : 0, ok, detail: `pick:${a.choice}` };
      },
    },
    {
      ms: TIMERS.intruso,
      judge(item, intent) {
        if (intent === null) return { points: 0, ok: false, detail: "Tempo scaduto" };
        const a = answerOf(intent);
        if (a?.choice === undefined) return "ignore";
        const ok = a.choice === item.correctLink;
        return { points: ok ? 2 : 0, ok, detail: `link:${a.choice}` };
      },
    },
  ],
  mask: (it) => ({ ...it, intruder: -1 as never, correctLink: -1 as never, script: "" }),
});

export const mappamondo = turnQuiz<MappamondoItem>({
  id: "mappamondo",
  count: 6,
  phases: [
    {
      ms: TIMERS.mappamondo,
      judge(item, intent) {
        if (intent === null) return { points: 0, ok: false, detail: "Tempo scaduto" };
        const a = answerOf(intent);
        if (a?.lat === undefined || a.lon === undefined) return "ignore";
        const km = haversineKm(a.lat, a.lon, item.target.lat, item.target.lon);
        const points = km < 25 ? 5 : km < 100 ? 3 : km < 300 ? 1 : 0;
        return { points, ok: points > 0, detail: `km:${Math.round(km)}` };
      },
    },
  ],
  mask: (it) => ({ ...it, target: { lat: NaN, lon: NaN, label: "" }, script: "" }),
});

export const maglia = turnQuiz<MagliaItem>({
  id: "maglia",
  count: 6,
  phases: [
    {
      ms: TIMERS.maglia,
      judge(item, intent, env) {
        if (intent === null) return { points: 0, ok: false, detail: "Tempo scaduto" };
        const v = verdictOf(intent);
        const a = answerOf(intent);
        let ok: boolean;
        if (v?.correct !== undefined) ok = v.correct;
        else if (a?.text !== undefined) ok = judgeText(a.text, item.answer, env.ctx.index);
        else return "ignore";
        return { points: ok ? 3 : 0, ok };
      },
    },
  ],
  mask: (it) => ({ ...it, answer: { kind: "text", accepted: [], display: "" }, script: "" }),
});

/** Validate a teammate chain from -> ... -> to. Returns the number of links or an error. */
export function validateChain(
  item: FiloRossoItem,
  names: string[],
  env: Env,
): { links: number } | { error: string } {
  const ids: string[] = [item.from.id];
  for (const n of names) {
    if (!n.trim()) continue;
    const r = resolve(n, env.ctx.index, ["person"]);
    if (r.status !== "ok") return { error: `Non riconosciuto: ${n}` };
    ids.push(r.id);
  }
  ids.push(item.to.id);
  for (let k = 0; k < ids.length - 1; k++) {
    const a = env.ctx.teammates.byPerson[ids[k]!] ?? [];
    const b = new Set(env.ctx.teammates.byPerson[ids[k + 1]!] ?? []);
    if (!a.some((g) => b.has(g))) return { error: `Anello non valido tra ${k} e ${k + 1}` };
  }
  return { links: ids.length - 1 };
}

export const filoRosso = turnQuiz<FiloRossoItem>({
  id: "filo_rosso",
  count: 2,
  phases: [
    {
      ms: TIMERS.filo_rosso,
      judge(item, intent, env) {
        if (intent === null) return { points: 0, ok: false, detail: "Tempo scaduto" };
        const a = answerOf(intent);
        if (!a?.chain) return "ignore";
        const r = validateChain(item, a.chain, env);
        if ("error" in r) return { points: 0, ok: false, detail: r.error };
        if (r.links > 6) return { points: 0, ok: false, detail: "Troppi anelli" };
        const points = r.links <= item.optimal ? 10 : r.links === item.optimal + 1 ? 5 : 2;
        return { points, ok: true, detail: `links:${r.links}` };
      },
    },
  ],
  mask: (it) => ({ ...it, solution: [], script: "" }),
});

/* ------------------------------------------------------------------ */
/* Buzzer games with progressive clues                                  */
/* ------------------------------------------------------------------ */

function clueBuzzer<I extends { clues: string[]; answer: MercatoItem["answer"]; script: string }>(
  id: GameId,
  count: number,
  points: number[],
): GameModule {
  const startItem = (s: GameStateAny, env: Env) => {
    s.stage = "ready";
    s.revealed = 0;
    s.out = [false, false];
    s.locked = [false, false];
    s.buzzer = null;
    s.free = false;
    s.winner = null;
    s.last = null;
    s.script = null;
    env.setTimer(TIMERS.ready, "ready");
  };
  const showClue = (s: GameStateAny, env: Env) => {
    const item = s.items[s.i] as I;
    if (s.revealed < item.clues.length) {
      s.revealed += 1;
      s.locked = [false, false];
      env.emit({ type: "clue", index: s.revealed - 1 });
    }
    if (env.judging === "host" && !s.free) {
      env.clearTimer();
    } else if (s.revealed >= item.clues.length) {
      env.setTimer(TIMERS.answer, "last");
    } else {
      env.setTimer(s.free ? TIMERS.freeClue : TIMERS.clue, "clue");
    }
  };
  const finish = (s: GameStateAny, env: Env) => {
    s.stage = "reveal";
    s.script = (s.items[s.i] as I).script;
    env.clearTimer();
    env.emit({ type: "reveal" });
  };
  return {
    id,
    count,
    init(items, env) {
      const s: GameStateAny = { game: id, stage: "ready", turn: null, items, i: 0, last: null, script: null, points };
      startItem(s, env);
      return s;
    },
    reduce(s, intent, env) {
      const item = s.items[s.i] as I;
      switch (s.stage) {
        case "ready":
          if (intent.type === "BUZZ") {
            s.locked[intent.player] = true;
            env.emit({ type: "false_start", player: intent.player });
          } else if (intent.type === "TIMEOUT") {
            s.stage = "clues";
            showClue(s, env);
          }
          return;
        case "clues":
          if (intent.type === "BUZZ") {
            const p = intent.player;
            if (s.out[p] || s.locked[p]) return;
            s.buzzer = p;
            s.turn = p;
            s.stage = "answering";
            env.emit({ type: "buzz", player: p });
            env.setTimer(TIMERS.answer, "answer");
          } else if (intent.type === "REVEAL_CLUE") {
            if (env.judging === "auto" && !s.free) return;
            if (s.revealed >= item.clues.length) return;
            showClue(s, env);
          } else if (intent.type === "TIMEOUT") {
            if (s.revealed < item.clues.length) showClue(s, env);
            else finish(s, env);
          }
          return;
        case "answering": {
          let ok: boolean;
          if (intent.type === "TIMEOUT") ok = false;
          else if (intent.type === "VERDICT" && intent.payload.correct !== undefined) ok = intent.payload.correct;
          else if (intent.type === "ANSWER" && intent.payload.text !== undefined) {
            if (intent.player !== undefined && intent.player !== s.buzzer) return;
            ok = judgeText(intent.payload.text, item.answer, env.ctx.index);
          } else return;
          const p = s.buzzer as PlayerIdx;
          if (ok) {
            const pts = points[Math.min(s.revealed, points.length) - 1] ?? 0;
            env.addPoints(p, pts);
            env.emit({ type: "correct", player: p, points: pts });
            s.winner = p;
            s.last = { player: p, points: pts, ok: true };
            finish(s, env);
            return;
          }
          s.out[p] = true;
          s.last = { player: p, points: 0, ok: false };
          env.emit({ type: "wrong", player: p, points: 0 });
          s.buzzer = null;
          s.turn = null;
          if (s.out[0] && s.out[1]) {
            finish(s, env);
            return;
          }
          s.stage = "clues";
          s.free = true;
          if (s.revealed >= item.clues.length) env.setTimer(TIMERS.answer, "last");
          else env.setTimer(TIMERS.freeClue, "clue");
          return;
        }
        case "reveal":
          if (intent.type === "NEXT") {
            s.i += 1;
            if (s.i >= s.items.length) s.stage = "done";
            else startItem(s, env);
          }
          return;
      }
    },
    done: (s) => s.stage === "done",
    redact(s, role) {
      if (role === "host") return s;
      const r = clone(s);
      r.items = r.items.map((it: I, idx: number) => {
        if (idx < s.i) return it;
        if (idx > s.i) return null;
        if (s.stage === "reveal") return it;
        return { ...it, clues: it.clues.slice(0, s.revealed), answer: { kind: "text", accepted: [], display: "" }, script: "" };
      });
      return r;
    },
  };
}

export const mercato = clueBuzzer<MercatoItem>("mercato", 3, [20, 15, 10, 5, 3, 2]);
export const giramondo = clueBuzzer<GiramondoItem>("giramondo", 2, [12, 9, 6, 3, 1]);

/* ------------------------------------------------------------------ */
/* La Decina                                                            */
/* ------------------------------------------------------------------ */

function listAnswer(
  s: GameStateAny,
  intent: Intent,
  members: { id: string; name: string }[],
  env: Env,
): { id: string; name: string } | null | "ignore" {
  const said = new Set<string>((s.said as { id: string }[]).map((x) => x.id));
  if (intent.type === "TIMEOUT") return null;
  if (intent.type === "VERDICT") {
    const id = intent.payload.id;
    if (id === undefined) return "ignore";
    const m = members.find((x) => x.id === id);
    return m && !said.has(m.id) ? m : null;
  }
  if (intent.type === "ANSWER" && intent.payload.text !== undefined) {
    if (env.judging === "auto" && intent.player !== undefined && intent.player !== s.turn) return "ignore";
    const m = judgeInSet(intent.payload.text, members, env.ctx.index);
    return m && !said.has(m.id) ? m : null;
  }
  return "ignore";
}

export const decina: GameModule = {
  id: "decina",
  count: 1,
  init(items, env) {
    env.setTimer(TIMERS.list, "ask");
    return {
      game: "decina",
      stage: "ask",
      turn: env.starter,
      items,
      item: items[0],
      said: [],
      errors: [0, 0],
      out: [false, false],
      last: null,
      script: null,
    };
  },
  reduce(s, intent, env) {
    const item = s.item as SetItem;
    if (s.stage === "ask") {
      const m = listAnswer(s, intent, item.members, env);
      if (m === "ignore") return;
      const p = s.turn as PlayerIdx;
      if (m) {
        s.said.push({ ...m, player: p });
        env.addPoints(p, 2);
        env.emit({ type: "correct", player: p, points: 2 });
        s.last = { player: p, points: 2, ok: true, detail: m.name };
        if (s.said.length >= 10) return final(s, env);
      } else {
        s.errors[p] += 1;
        if (s.errors[p] >= 2) s.out[p] = true;
        env.emit({ type: "wrong", player: p, points: 0 });
        if (intent.type === "TIMEOUT") env.emit({ type: "timeout" });
        s.last = { player: p, points: 0, ok: false };
        if (s.out[0] && s.out[1]) return final(s, env);
      }
      s.stage = "feedback";
      env.setTimer(TIMERS.feedback, "feedback");
      return;
    }
    if (s.stage === "feedback" && (intent.type === "TIMEOUT" || intent.type === "NEXT")) {
      const o = other(s.turn);
      s.turn = s.out[o] ? s.turn : o;
      s.stage = "ask";
      env.setTimer(TIMERS.list, "ask");
      return;
    }
    if (s.stage === "final" && intent.type === "NEXT") s.stage = "done";
  },
  done: (s) => s.stage === "done",
  redact(s, role) {
    if (role === "host" || s.stage === "final" || s.stage === "done") return s;
    const r = clone(s);
    r.item = { ...r.item, members: [], script: "" };
    r.items = [];
    return r;
  },
};

function final(s: GameStateAny, env: Env) {
  s.stage = "final";
  s.script = (s.item ?? s.items[s.k ?? 0])?.script ?? null;
  env.clearTimer();
  env.emit({ type: "reveal" });
}

/* ------------------------------------------------------------------ */
/* Dal Dischetto                                                        */
/* ------------------------------------------------------------------ */

export const dischetto: GameModule = {
  id: "dischetto",
  count: 1,
  init(items, env) {
    env.setTimer(TIMERS.list, "ask");
    return {
      game: "dischetto",
      stage: "ask",
      turn: env.starter,
      items,
      item: items[0],
      said: [],
      shots: [0, 0],
      kicks: [[], []],
      tenthClosed: false,
      last: null,
      script: null,
    };
  },
  reduce(s, intent, env) {
    const item = s.item as DischettoItem;
    if (s.stage === "ask") {
      const top = item.ranking.filter((r) => r.rank <= 10);
      const answered = listAnswer(s, intent, top, env);
      if (answered === "ignore") return;
      let m: { id: string; name: string } | null = answered;
      const p = s.turn as PlayerIdx;
      if (m) {
        const hitId = m.id;
        const entry = top.find((r) => r.id === hitId)!;
        if (entry.rank === 10) {
          if (s.tenthClosed) m = null;
          else s.tenthClosed = true;
        }
      }
      s.shots[p] += 1;
      if (m) {
        s.said.push({ id: m.id, name: m.name, player: p });
        s.kicks[p].push(true);
        env.addPoints(p, 2);
        env.emit({ type: "goal", player: p, points: 2 });
        s.last = { player: p, points: 2, ok: true, detail: m.name };
      } else {
        s.kicks[p].push(false);
        env.emit({ type: "miss", player: p });
        s.last = { player: p, points: 0, ok: false };
      }
      s.stage = "feedback";
      env.setTimer(TIMERS.feedback, "feedback");
      return;
    }
    if (s.stage === "feedback" && (intent.type === "TIMEOUT" || intent.type === "NEXT")) {
      if (s.shots[0] >= 5 && s.shots[1] >= 5) return final(s, env);
      const o = other(s.turn);
      s.turn = s.shots[o] < 5 ? o : s.turn;
      s.stage = "ask";
      env.setTimer(TIMERS.list, "ask");
      return;
    }
    if (s.stage === "final" && intent.type === "NEXT") s.stage = "done";
  },
  done: (s) => s.stage === "done",
  redact(s, role) {
    if (role === "host" || s.stage === "final" || s.stage === "done") return s;
    const r = clone(s);
    const said = new Set((s.said as { id: string }[]).map((x) => x.id));
    r.item = {
      ...r.item,
      ranking: (r.item as DischettoItem).ranking.map((e) =>
        said.has(e.id) || e.rank === 1 || e.rank === 10 ? { ...e, ...(said.has(e.id) ? {} : { id: "", name: "" }) } : { ...e, id: "", name: "", value: -1 },
      ),
      script: "",
    };
    r.items = [];
    return r;
  },
};

/* ------------------------------------------------------------------ */
/* La Formazione                                                        */
/* ------------------------------------------------------------------ */

const FORMAZIONE_POINTS = [0, 2, 3, 5, 10, 15];

export const formazione: GameModule = {
  id: "formazione",
  count: 1,
  init(items, env) {
    env.clearTimer();
    return {
      game: "formazione",
      stage: "choose",
      turn: env.starter,
      starter: env.starter,
      items,
      item: items[0],
      teamOf: [null, null],
      round: 0,
      found: [],
      results: [null, null],
      last: null,
      script: null,
    };
  },
  reduce(s, intent, env) {
    const item = s.item as FormazioneItem;
    const score = () => {
      const p = s.turn as PlayerIdx;
      const n = Math.min(5, s.found.length);
      const pts = FORMAZIONE_POINTS[n]!;
      if (pts) env.addPoints(p, pts);
      env.emit(pts ? { type: "correct", player: p, points: pts } : { type: "wrong", player: p, points: 0 });
      s.results[p] = n;
      s.last = { player: p, points: pts, ok: n > 0, detail: `${n}/5` };
      s.stage = "reveal";
      s.script = item.script;
      env.clearTimer();
      env.emit({ type: "reveal" });
    };
    if (s.stage === "choose" && intent.type === "CHOOSE") {
      if (intent.player !== undefined && intent.player !== s.starter) return;
      const t = intent.value === 1 ? 1 : 0;
      s.teamOf[s.starter] = t;
      s.teamOf[other(s.starter)] = 1 - t;
      s.stage = "play";
      env.setTimer(TIMERS.formazione, "play");
      return;
    }
    if (s.stage === "play") {
      const team = item.teams[s.teamOf[s.turn] as 0 | 1];
      const hidden = team.players.filter((p) => p.hidden && !s.found.includes(p.id));
      if (intent.type === "ANSWER" && intent.payload.text !== undefined) {
        if (env.judging === "auto" && intent.player !== undefined && intent.player !== s.turn) return;
        const m = judgeInSet(intent.payload.text, hidden, env.ctx.index);
        if (m) {
          s.found.push(m.id);
          env.emit({ type: "notice", text: m.name });
          if (s.found.length >= 5) score();
        } else {
          env.emit({ type: "miss", player: s.turn });
        }
        return;
      }
      if (intent.type === "VERDICT" && intent.payload.ids) {
        const valid = new Set(team.players.filter((p) => p.hidden).map((p) => p.id));
        s.found = intent.payload.ids.filter((id) => valid.has(id)).slice(0, 5);
        score();
        return;
      }
      if (intent.type === "FINISH" || intent.type === "TIMEOUT") score();
      return;
    }
    if (s.stage === "reveal" && intent.type === "NEXT") {
      s.round += 1;
      if (s.round >= 2) {
        s.stage = "done";
        return;
      }
      s.turn = other(s.starter);
      s.found = [];
      s.last = null;
      s.script = null;
      s.stage = "play";
      env.setTimer(TIMERS.formazione, "play");
    }
  },
  done: (s) => s.stage === "done",
  redact(s, role) {
    if (role === "host") return s;
    const r = clone(s);
    const item = r.item as FormazioneItem;
    item.teams.forEach((team, t) => {
      const ownerIdx = s.teamOf.indexOf(t);
      const finished =
        s.stage === "done" ||
        (ownerIdx !== -1 && s.results[ownerIdx] !== null && !(s.stage === "play" && s.turn === ownerIdx));
      if (finished) return;
      team.players = team.players.map((p) =>
        p.hidden && !s.found.includes(p.id) ? { ...p, id: "", name: "" } : p,
      );
    });
    item.script = "";
    r.items = [];
    return r;
  },
};

/* ------------------------------------------------------------------ */
/* La Cassaforte (finale)                                               */
/* ------------------------------------------------------------------ */

const CASSA_OK = [0, 10, 20, 30];
const CASSA_KO = [0, -30, -20, -10];

export const cassaforte: GameModule = {
  id: "cassaforte",
  count: 3,
  perPlayer: true,
  init(items, env) {
    env.clearTimer();
    const s = env.starter;
    return {
      game: "cassaforte",
      stage: "choose",
      turn: s,
      items,
      picks: [s, other(s), s, other(s)],
      k: 0,
      chosen: [[], []],
      current: null,
      last: null,
      script: null,
    };
  },
  reduce(s, intent, env) {
    const p = s.picks[s.k] as PlayerIdx;
    if (s.stage === "choose" && intent.type === "CHOOSE") {
      if (intent.player !== undefined && intent.player !== p) return;
      const level = intent.value;
      if (![1, 2, 3].includes(level) || s.chosen[p].includes(level)) return;
      s.chosen[p].push(level);
      const item = (s.items[p] as CassaforteItem[]).find((it) => it.level === level)!;
      s.current = { player: p, level, item };
      s.stage = "ask";
      env.setTimer(TIMERS.cassaforte, "ask");
      return;
    }
    if (s.stage === "ask") {
      const item = s.current.item as CassaforteItem;
      let ok: boolean;
      if (intent.type === "TIMEOUT") ok = false;
      else if (intent.type === "VERDICT" && intent.payload.correct !== undefined) ok = intent.payload.correct;
      else if (intent.type === "ANSWER" && (intent.payload.texts || intent.payload.text !== undefined)) {
        if (env.judging === "auto" && intent.player !== undefined && intent.player !== p) return;
        const texts = intent.payload.texts ?? [intent.payload.text!];
        ok = item.parts.every((part, k) => judgeText(texts[k] ?? "", part, env.ctx.index));
      } else return;
      const level = s.current.level as 1 | 2 | 3;
      const pts = ok ? CASSA_OK[level]! : CASSA_KO[level]!;
      env.addPoints(p, pts);
      env.emit(ok ? { type: "correct", player: p, points: pts } : { type: "malus", player: p, points: pts });
      s.last = { player: p, points: pts, ok };
      s.stage = "reveal";
      s.script = item.script;
      env.clearTimer();
      env.emit({ type: "reveal" });
      return;
    }
    if (s.stage === "reveal" && intent.type === "NEXT") {
      s.k += 1;
      s.current = null;
      s.last = null;
      s.script = null;
      if (s.k >= 4) {
        s.stage = "done";
        return;
      }
      s.turn = s.picks[s.k];
      s.stage = "choose";
    }
  },
  done: (s) => s.stage === "done",
  redact(s, role) {
    if (role === "host") return s;
    const r = clone(s);
    r.items = [[], []];
    if (r.current && s.stage !== "reveal") {
      r.current.item = { ...r.current.item, parts: [], script: "" };
    }
    return r;
  },
};

/* ------------------------------------------------------------------ */
/* L'Asta                                                               */
/* ------------------------------------------------------------------ */

export const asta: GameModule = {
  id: "asta",
  count: 2,
  init(items, env) {
    env.clearTimer();
    const first = items[0] as SetItem;
    return {
      game: "asta",
      stage: "bidding",
      turn: env.starter,
      starter: env.starter,
      items,
      k: 0,
      item: first,
      max: Math.min(10, first.members.length),
      bid: null,
      said: [],
      last: null,
      script: null,
    };
  },
  reduce(s, intent, env) {
    const item = s.item as SetItem;
    const startProving = (winner: PlayerIdx, amount: number) => {
      s.bid = { player: winner, amount };
      s.turn = winner;
      s.said = [];
      s.stage = "proving";
      env.setTimer(TIMERS.asta, "prove");
    };
    const resolveAuction = (ok: boolean) => {
      const w = s.bid.player as PlayerIdx;
      if (ok) {
        env.addPoints(w, s.bid.amount);
        env.emit({ type: "correct", player: w, points: s.bid.amount });
        s.last = { player: w, points: s.bid.amount, ok: true };
      } else {
        env.addPoints(other(w), 5);
        env.emit({ type: "wrong", player: w, points: 0 });
        s.last = { player: other(w), points: 5, ok: false };
      }
      s.stage = "reveal";
      s.script = item.script;
      env.clearTimer();
      env.emit({ type: "reveal" });
    };
    if (s.stage === "bidding") {
      if (intent.type === "BID") {
        if (intent.player !== s.turn) return;
        const current = s.bid?.amount ?? 0;
        if (intent.amount <= current || intent.amount > s.max) return;
        s.bid = { player: intent.player, amount: intent.amount };
        if (intent.amount === s.max) return startProving(intent.player, intent.amount);
        s.turn = other(intent.player);
        return;
      }
      if (intent.type === "PASS") {
        if (intent.player !== s.turn) return;
        if (!s.bid) return startProving(other(intent.player), 1);
        return startProving(s.bid.player, s.bid.amount);
      }
      return;
    }
    if (s.stage === "proving") {
      if (intent.type === "TIMEOUT" || intent.type === "FINISH") return resolveAuction(false);
      const m = listAnswer(s, intent, item.members, env);
      if (m === "ignore") return;
      if (m) {
        s.said.push({ ...m, player: s.turn });
        env.emit({ type: "notice", text: m.name });
        if (s.said.length >= s.bid.amount) resolveAuction(true);
      } else {
        env.emit({ type: "miss", player: s.turn });
      }
      return;
    }
    if (s.stage === "reveal" && intent.type === "NEXT") {
      s.k += 1;
      if (s.k >= s.items.length) {
        s.stage = "done";
        return;
      }
      s.item = s.items[s.k];
      s.max = Math.min(10, (s.item as SetItem).members.length);
      s.bid = null;
      s.said = [];
      s.last = null;
      s.script = null;
      s.turn = other(s.starter);
      s.stage = "bidding";
    }
  },
  done: (s) => s.stage === "done",
  redact(s, role) {
    if (role === "host" || s.stage === "reveal" || s.stage === "done") return s;
    const r = clone(s);
    r.item = { ...r.item, members: [], script: "" };
    r.items = [];
    return r;
  },
};

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

export const MODULES: Record<GameId, GameModule> = {
  tiro_secco: tiroSecco,
  prima_pagina: primaPagina,
  mercato,
  decina,
  dischetto,
  formazione,
  cassaforte,
  giramondo,
  frame,
  intruso,
  asta,
  filo_rosso: filoRosso,
  mappamondo,
  maglia,
};

export function redactGame(s: GameStateAny, role: Role): GameStateAny {
  return MODULES[s.game].redact(s, role);
}

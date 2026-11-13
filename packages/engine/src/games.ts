import type {
  AnomaliaItem,
  DischettoItem,
  FormazioneItem,
  GameId,
  GiramondoItem,
  MagliaItem,
  MercatoItem,
  PlayerIdx,
  Role,
  SetItem,
  TiroSeccoItem,
} from "@trivela/protocol";
import { judgeInSet, judgeText } from "@trivela/matcher";
import { other, type Env, type GameModule, type GameStateAny, type Intent } from "./types";

/** Default timers (ms). */
export const TIMERS = {
  tiro_secco: 20_000,
  anomalia: 25_000,
  ready: 2_000,
  clue: 8_000,
  freeClue: 20_000,
  answer: 10_000,
  list: 30_000,
  feedback: 1_500,
  formazione: 60_000,
  asta: 60_000,
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
  /** The answer given, kept to show a wrong one on the Screen. */
  said?: string;
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

function turnOf(i: number, starter: PlayerIdx, solo = false): PlayerIdx {
  if (solo) return 0;
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
        s.last = { player, points: r.points, ok: r.ok, detail: r.detail, said: r.ok ? undefined : r.said };
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
        s.turn = turnOf(s.i, s.starter, env.solo);
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

/** Four options, one correct: used by Tiro Secco and L'Anomalia Statistica. */
const pickOne = (points: number) => (item: { correct: number; options: readonly string[] }, intent: Intent | null) => {
  if (intent === null) return { points: 0, ok: false, detail: "Tempo scaduto" };
  const a = answerOf(intent);
  if (a?.choice === undefined || !Number.isInteger(a.choice) || a.choice < 0 || a.choice > 3) return "ignore" as const;
  const ok = a.choice === item.correct;
  return { points: ok ? points : 0, ok, detail: `choice:${a.choice}`, said: item.options[a.choice] };
};

export const tiroSecco = turnQuiz<TiroSeccoItem>({
  id: "tiro_secco",
  count: 4,
  phases: [{ ms: TIMERS.tiro_secco, judge: pickOne(2) }],
  mask: (it) => ({ ...it, correct: -1 as never, script: "" }),
});

export const anomalia = turnQuiz<AnomaliaItem>({
  id: "anomalia",
  count: 4,
  phases: [{ ms: TIMERS.anomalia, judge: pickOne(3) }],
  mask: (it) => ({ ...it, correct: -1 as never, script: "" }),
});

export const maglia = turnQuiz<MagliaItem>({
  id: "maglia",
  count: 4,
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
        return { points: ok ? 3 : 0, ok, said: a?.text };
      },
    },
  ],
  mask: (it) => ({ ...it, answer: { kind: "text", accepted: [], display: "" }, script: "" }),
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
    s.out = [false, env.solo];
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
          let said: string | undefined;
          if (intent.type === "TIMEOUT") ok = false;
          else if (intent.type === "VERDICT" && intent.payload.correct !== undefined) ok = intent.payload.correct;
          else if (intent.type === "ANSWER" && intent.payload.text !== undefined) {
            if (intent.player !== undefined && intent.player !== s.buzzer) return;
            ok = judgeText(intent.payload.text, item.answer, env.ctx.index);
            said = intent.payload.text;
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
          s.last = { player: p, points: 0, ok: false, said };
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

export const mercato = clueBuzzer<MercatoItem>("mercato", 2, [20, 15, 10, 5, 3, 2]);
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
      out: [false, env.solo],
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
        s.last = { player: p, points: 0, ok: false, said: typedText(intent) };
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

/** The text of an answer, if one was typed (nothing when the host judged or the time ran out). */
const typedText = (intent: Intent): string | undefined => (intent.type === "ANSWER" ? intent.payload.text : undefined);

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
      shots: [0, env.solo ? 5 : 0],
      kicks: [[], []],
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
          // players tied at the last useful place share the places left in the top 10
          const places = 10 - top.filter((r) => r.rank < 10).length;
          const taken = (s.said as { id: string }[]).filter((x) => top.find((r) => r.id === x.id)?.rank === 10).length;
          if (taken >= places) m = null;
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
        s.last = { player: p, points: 0, ok: false, said: typedText(intent) };
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
        said.has(e.id) || e.rank === 1 || e.rank === 10 ? { ...e, ...(said.has(e.id) ? {} : { id: "", name: "" }) } : { ...e, id: "", name: "", value: -1, label: undefined },
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
      wrong: null,
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
      s.wrong = null;
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
          s.wrong = null;
          env.emit({ type: "notice", text: m.name });
          if (s.found.length >= 5) score();
        } else {
          s.wrong = { player: s.turn, text: intent.payload.text };
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
      if (s.round >= (env.solo ? 1 : 2)) {
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
      wrong: null,
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
      } else if (env.solo) {
        env.emit({ type: "wrong", player: w, points: 0 });
        s.last = { player: w, points: 0, ok: false };
      } else {
        env.addPoints(other(w), 5);
        env.emit({ type: "wrong", player: w, points: 0 });
        s.last = { player: other(w), points: 5, ok: false };
      }
      s.wrong = null;
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
        if (intent.amount === s.max || env.solo) return startProving(intent.player, intent.amount); // alone: no one to outbid
        s.turn = other(intent.player);
        return;
      }
      if (intent.type === "PASS") {
        if (env.solo || intent.player !== s.turn) return;
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
        s.wrong = null;
        env.emit({ type: "notice", text: m.name });
        if (s.said.length >= s.bid.amount) resolveAuction(true);
      } else {
        s.wrong = { player: s.turn, text: typedText(intent) ?? null };
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
      s.turn = env.solo ? 0 : other(s.starter);
      s.wrong = null;
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
  anomalia,
  mercato,
  decina,
  dischetto,
  formazione,
  giramondo,
  asta,
  maglia,
};

export function redactGame(s: GameStateAny, role: Role): GameStateAny {
  return MODULES[s.game].redact(s, role);
}

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { DischettoItem, FormazioneItem, MagliaItem, PlayerIdx, QuotazioneItem, SetItem, SourceRef, TestaItem, TiroSeccoItem } from "@trivela/protocol";
import { isTimed, TESTA_POT, type EngineCtx, type GameStateAny, type Intent, type MatchState } from "@trivela/engine";
import { AnswerBox, Copione, Fit, NextButton, NumberPad, PhoneHint, Result, StateTimer, usePlay, VoteBadge, WrongSaid } from "../components/ui";
import { Sprite } from "../components/sprites";
import { HAPTIC, vibrate } from "../runtime/haptics";

export interface GameProps {
  state: MatchState;
  /** Redacted game state (what the screen may show). */
  g: GameStateAny;
  dispatch: (i: Intent) => void;
  ctx: EngineCtx;
  start: number;
  tableMode?: boolean;
}

/** Names to print next to results: nobody's name in Allenamento, where there is no opponent to tell apart. */
const namesOf = (state: MatchState): [string, string] => (state.config.solo ? ["", ""] : state.config.players);

const pc = (p: PlayerIdx | null | undefined) => (p === 0 ? "c-p1" : p === 1 ? "c-p2" : "");

function TurnBar({ state, p, text = "TOCCA A", info, children }: { state: MatchState; p: PlayerIdx | null | undefined; text?: string; info?: string; children?: ReactNode }) {
  return (
    <div className="turnbar">
      {p !== null && p !== undefined && (
        <span key={p} className={`who ${pc(p)}`}>
          <span>
            {text} {state.config.players[p]}
          </span>
        </span>
      )}
      <span className="grow" />
      {children}
      {info && <span className="info">{info}</span>}
    </div>
  );
}

function RevealFooter({ g, state, dispatch, sources, solution }: { g: GameStateAny; state: MatchState; dispatch: (i: Intent) => void; sources?: SourceRef[]; solution?: ReactNode }) {
  return (
    <div className="reveal">
      <div className="reveal-row">
        <Result last={g.last} players={namesOf(state)} />
        {solution && <span className="solution">{solution}</span>}
        <span className="grow" />
        <NextButton onClick={() => dispatch({ type: "NEXT" })} />
      </div>
      <Copione text={g.script} sources={sources} />
    </div>
  );
}

/** Without countdowns the player on turn can give up an answer (it counts as the time running out). */
function PassButton({ state, dispatch, player, label = "PASSO" }: { state: MatchState; dispatch: (i: Intent) => void; player: PlayerIdx | null; label?: string }) {
  if (isTimed(state.config) || player === null) return null;
  return (
    <button className="btn small ghost pass-btn" onClick={() => dispatch({ type: "SKIP", player })}>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------ Tiro Secco */

/** The four options with the keyboard shortcuts, the reveal colours and the answers disabled on a read-only Screen. */
function FourOptions({ item, g, dispatch }: { item: { options: string[]; correct: number }; g: GameStateAny; dispatch: (i: Intent) => void }) {
  const { readonly } = usePlay();
  const reveal = g.stage === "reveal";
  const picked = Number(String(g.last?.detail ?? "").split(":")[1] ?? -1);
  useEffect(() => {
    if (reveal || readonly) return;
    const h = (e: KeyboardEvent) => {
      const k = "abcd1234".indexOf(e.key.toLowerCase());
      if (k >= 0 && !(e.target instanceof HTMLInputElement)) dispatch({ type: "ANSWER", payload: { choice: k % 4 } });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [reveal, readonly, dispatch]);
  return (
    <div className="options">
      {item.options.map((o, k) => (
        <button
          key={k}
          style={{ "--i": k } as CSSProperties}
          className={`option ${reveal && k === item.correct ? "right" : ""} ${reveal && k === picked && k !== item.correct ? "wrongpick" : ""}`}
          disabled={reveal || readonly}
          onClick={() => dispatch({ type: "ANSWER", payload: { choice: k } })}
        >
          <span className="key">{"ABCD"[k]}</span>
          {o}
        </button>
      ))}
    </div>
  );
}

function TiroSecco({ state, g, dispatch, start }: GameProps) {
  const item = g.items[g.i] as TiroSeccoItem;
  return (
    <>
      <TurnBar state={state} p={g.turn} info={`DOMANDA ${g.i + 1}/${g.items.length}`} />
      <StateTimer state={state} start={start} />
      <div className="q-card" key={g.i}>
        {item.tag && <div className={`q-tag ${item.tag}`}>{item.tag === "record" ? "⚠ RECORD RARISSIMO" : "✎ GIOCO DI NOMI"}</div>}
        <div className="q">{item.question}</div>
      </div>
      <FourOptions key={`o${g.i}`} item={item} g={g} dispatch={dispatch} />
      {g.stage === "reveal" && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />}
    </>
  );
}

/* ------------------------------------------------------------ Buzzer games */

/** A clue is plain text, or career steps "2018 Club; 2019 Club": each step becomes a badge with the year. */
function ClueText({ text }: { text: string }) {
  const steps = text.split("; ").map((x) => x.match(/^(\d{4}) (.+)$/));
  if (!steps.every(Boolean)) return <span>{text}</span>;
  return (
    <span className="steps">
      {steps.map((m, k) => (
        <span key={k} className="step">
          <b>{m![1]}</b>
          {m![2]}
        </span>
      ))}
    </span>
  );
}

export function ClueBuzzer({ state, g, dispatch, ctx, start, tableMode }: GameProps) {
  const { readonly } = usePlay();
  const item = g.items[g.i] as { clues: string[]; answer: { display: string }; sources: SourceRef[] };
  const points: number[] = g.points;
  const total = points.length;
  const canBuzz = (p: PlayerIdx) => (g.stage === "clues" || g.stage === "ready") && !g.out[p];
  const buzz = (p: PlayerIdx) => {
    if (!readonly && canBuzz(p)) {
      vibrate(HAPTIC.buzz);
      dispatch({ type: "BUZZ", player: p });
    }
  };
  useEffect(() => {
    if (readonly) return;
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key.toLowerCase() === "a") buzz(0);
      if (e.key.toLowerCase() === "l") buzz(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  const side = (p: PlayerIdx) => {
    const hit = g.stage === "answering" && g.buzzer === p;
    const label = g.out[p] ? "FUORI" : hit ? "RISPONDE!" : g.winner === p ? "PRESO!" : g.locked?.[p] ? "FALSA PARTENZA" : "PREMI!";
    return (
      <button
        className={`buzz-btn ${p === 0 ? "p1" : "p2"} ${hit ? "hit" : ""} ${canBuzz(p) && g.stage === "clues" ? "live" : ""} ${readonly ? "status" : ""}`}
        disabled={!canBuzz(p) && !hit && g.winner !== p}
        onPointerDown={(e) => {
          e.preventDefault();
          buzz(p);
        }}
      >
        <span>
          {state.config.players[p]}
          <span className="big">{label}</span>
          {readonly ? "dal telefono" : `tasto ${p === 0 ? "A" : "L"}`}
        </span>
      </button>
    );
  };
  const solo = state.config.solo === true;
  const timed = isTimed(state.config);
  return (
    <div className={`buzz-layout ${tableMode ? "table-mode" : ""} ${solo ? "solo" : ""}`}>
      {side(0)}
      <Fit>
        <div className="view">
          <div className="turnbar">
            <span className="who c-accent">
              <span>
                {g.game === "mercato" ? "TRASFERIMENTO" : g.game === "quotazione" ? "QUOTAZIONE" : "CARRIERA"} {g.i + 1}/{g.items.length}
              </span>
            </span>
            <span className="grow" />
            {g.stage === "ready" && <span className="px blink c-accent">PRONTI…</span>}
            {g.stage === "clues" && readonly && (g.free || !timed) && <VoteBadge action="clue" />}
            {g.stage === "clues" && !readonly && (g.free || !timed) && (
              <button className={`btn small ${timed ? "ghost" : "next-clue"}`} onClick={() => dispatch({ type: "REVEAL_CLUE" })} disabled={timed && g.revealed >= total}>
                {g.revealed >= total ? "NESSUNO LO SA ▶" : timed ? "SCOPRI INDIZIO" : "PROSSIMO INDIZIO ▶"}
              </button>
            )}
          </div>
          <StateTimer state={state} start={start} />
          {g.game === "giramondo" && <div className="sub">Le squadre in ordine di primo arrivo, con l'anno.</div>}
          {g.game === "quotazione" ? (
            <QuotazioneBoard key={g.i} item={item as unknown as QuotazioneItem} revealed={g.stage === "reveal" ? total : g.revealed} points={points} />
          ) : (
          <div className="clues" key={g.i}>
            {Array.from({ length: total }, (_, k) => (
              <div key={k} className={`clue ${k < g.revealed ? "shown" : "hidden"} ${k === g.revealed - 1 && g.stage !== "reveal" ? "current" : ""}`}>
                <span className="pts">{points[k]} PT</span>
                {k < g.revealed || g.stage === "reveal" ? <ClueText text={item.clues[k]!} /> : <span>? ? ?</span>}
              </div>
            ))}
          </div>
          )}
          {g.stage === "clues" && g.last && !g.last.ok && (
            <WrongSaid text={g.last.said} who={namesOf(state)[g.last.player as PlayerIdx]} />
          )}
          {g.stage === "answering" && (
            <div className="col" style={{ gap: 10 }}>
              <TurnBar state={state} p={g.buzzer} text="RISPONDE" />
              {readonly ? <PhoneHint /> : <AnswerBox index={ctx.index} placeholder="Chi è?" prompt={`${state.config.players[g.buzzer as PlayerIdx]}, chi è? · ${item.clues[g.revealed - 1] ?? ""}`} timer={<StateTimer state={state} start={start} />} actions={<PassButton state={state} dispatch={dispatch} player={g.buzzer} label="NON LO SO" />} onSubmit={(text) => dispatch({ type: "ANSWER", player: g.buzzer, payload: { text } })} />}
              {!readonly && <PassButton state={state} dispatch={dispatch} player={g.buzzer} label="NON LO SO" />}
            </div>
          )}
          {g.stage === "reveal" && (
            <>
              <div className="big-answer">{item.answer.display}</div>
              <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />
            </>
          )}
        </div>
      </Fit>
      {solo ? <div /> : side(1)}
    </div>
  );
}

/* ------------------------------------------------------------ La Quotazione */

const W = 800;
const H = 300;
const PAD = { l: 64, r: 16, t: 34, b: 30 };

/**
 * The market value of a player over time, as a stepped pixel line (SPEC §4.11). The view gets only the part of the
 * curve already uncovered; the rest of the time span is a hatched curtain that slides away (transform only).
 */
export function ValueChart({ item, revealed }: { item: QuotazioneItem; revealed: number }) {
  const pts = item.curve;
  const first = item.span?.[0] ?? pts[0]?.t ?? 2010;
  const last = item.span?.[1] ?? pts[pts.length - 1]?.t ?? first + 1;
  const t0 = Math.floor(first);
  const t1 = Math.max(t0 + 1, Math.ceil(last));
  const top = Math.max(1, ...pts.map((p) => p.v));
  const step = top > 100 ? 50 : top > 40 ? 20 : top > 10 ? 5 : top > 4 ? 2 : 1;
  const vmax = Math.ceil(top / step) * step;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / vmax) * (H - PAD.t - PAD.b);
  // the whole curve is out from the fourth clue: no curtain left, not even a sliver after the last value
  const shownUntil = revealed >= 4 ? W : pts.length ? x(pts[pts.length - 1]!.t) : PAD.l;
  // names on the flags only when they fit; a long loan career is read in the list of clubs under the chart
  const labels = item.moves.length <= 5;
  let d = "";
  pts.forEach((p, k) => {
    d += k === 0 ? `M${x(p.t)},${y(p.v)}` : `H${x(p.t)}V${y(p.v)}`;
  });
  const peak = revealed >= 4 && pts.length ? pts.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const years = Array.from({ length: t1 - t0 + 1 }, (_, k) => t0 + k).filter((yr, _k, all) => all.length <= 12 || (yr - t0) % 2 === 0);
  return (
    <svg className="value-chart" viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" role="img" aria-label="Curva del valore di mercato">
      {Array.from({ length: vmax / step + 1 }, (_, k) => (
        <g key={k}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(k * step)} y2={y(k * step)} className="grid" />
          <text x={PAD.l - 8} y={y(k * step) + 5} className="axis" textAnchor="end">
            {k * step}
          </text>
        </g>
      ))}
      <text x={6} y={18} className="axis unit">
        MLN €
      </text>
      {years.map((yr) => (
        <text key={yr} x={x(yr)} y={H - 8} className="axis" textAnchor="middle">
          {String(yr).slice(2)}
        </text>
      ))}
      {item.moves.map((m, k) => (
        <g key={k} className="move">
          <line x1={x(m.t)} x2={x(m.t)} y1={PAD.t - 6} y2={H - PAD.b} />
          <rect x={x(m.t)} y={PAD.t - 14} width={14} height={10} />
          {m.club && labels && (
            <text x={Math.min(x(m.t) + 18, W - 150)} y={PAD.t - 5 + (k % 3) * 20} className="club">
              {m.club}
            </text>
          )}
        </g>
      ))}
      <path d={d} className="curve" />
      {peak && (
        <g className="peak">
          <rect x={x(peak.t) - 7} y={y(peak.v) - 7} width={14} height={14} />
          <text x={Math.min(x(peak.t), W - 120)} y={y(peak.v) < PAD.t + 50 ? y(peak.v) + 30 : y(peak.v) - 14} textAnchor="middle">
            {peak.v} MLN
          </text>
        </g>
      )}
      <g className="curtain" style={{ transform: `translateX(${shownUntil}px)` }}>
        <rect x={0} y={PAD.t - 18} width={W} height={H - PAD.t - PAD.b + 18} />
        {revealed < 4 && (
          <text x={(W - PAD.r - shownUntil) / 2} y={H / 2} textAnchor="middle">
            ? ? ?
          </text>
        )}
      </g>
    </svg>
  );
}

function QuotazioneBoard({ item, revealed, points }: { item: QuotazioneItem; revealed: number; points: number[] }) {
  const facts = item.clues.slice(3, Math.max(3, revealed));
  return (
    <div className="quotazione">
      <div className="q-steps">
        {points.map((pt, k) => (
          <span key={k} className={k < revealed ? "on" : ""}>
            {pt}
          </span>
        ))}
      </div>
      <ValueChart item={item} revealed={revealed} />
      {facts.length > 0 && (
        <div className="q-facts">
          {facts.map((f, k) => (
            <span key={k}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Testa a Testa */

function TestaATesta({ state, g, dispatch, start }: GameProps) {
  const { readonly } = usePlay();
  const item = g.items[g.i] as TestaItem;
  const k: number = g.k;
  const reveal = g.stage === "reveal";
  const deciding = g.stage === "decide";
  const known = item.chain[deciding ? k : k - 1]!;
  const next = item.chain[deciding ? k + 1 : k];
  const nextPot = TESTA_POT[k];
  const choose = (choice: 0 | 1) => dispatch({ type: "ANSWER", payload: { choice } });
  useEffect(() => {
    if (readonly || reveal) return;
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowUp" || e.key === "+") choose(1);
      else if (e.key === "ArrowDown" || e.key === "-") choose(0);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  return (
    <>
      <TurnBar state={state} p={g.turn} info={`CATENA ${g.i + 1}/${g.items.length}`} />
      <StateTimer state={state} start={start} />
      <div className="q-card">
        <div className="q small">{item.title}</div>
        <div className="sub">{item.definition}</div>
      </div>
      <div className="pot-ladder" aria-label="Piatto">
        {TESTA_POT.map((v, j) => (
          <span key={j} className={`${g.pot === v && !reveal ? "now" : ""} ${j < (deciding ? k : k - 1) ? "done" : ""}`}>
            {v}
          </span>
        ))}
        <b className={`pot-now ${deciding ? "c-ok" : ""}`}>{deciding ? `GIUSTO! PIATTO ${g.pot} · RISCHI PER ${nextPot}?` : `PIATTO ${reveal ? g.last?.points ?? 0 : g.pot}`}</b>
      </div>
      {!reveal ? (
        <div className="duel" key={`${g.i}-${k}-${g.stage}`}>
          <div className="duel-card known">
            <span className="name">{known.name}</span>
            <span className="value">{known.label}</span>
          </div>
          <span className="vs">VS</span>
          <div className="duel-card next">
            <span className="name">{next?.name}</span>
            <span className="value q">???</span>
          </div>
        </div>
      ) : (
        <div className="chain-reveal">
          {item.chain.map((c, j) => (
            <span key={j} className={j <= k ? "played" : ""}>
              <b>{c.name}</b> {c.label}
            </span>
          ))}
        </div>
      )}
      {!reveal &&
        (readonly ? (
          <PhoneHint />
        ) : g.stage === "guess" ? (
          <div className="duel-actions">
            <button className="btn big more" onClick={() => choose(1)}>
              ▲ PIÙ
            </button>
            <button className="btn big less" onClick={() => choose(0)}>
              ▼ MENO
            </button>
          </div>
        ) : (
          <div className="duel-actions">
            <button className="btn big cash" onClick={() => choose(0)}>
              INCASSA {g.pot}
            </button>
            <button className="btn big ghost" onClick={() => choose(1)}>
              CONTINUA ▶ {nextPot}
            </button>
          </div>
        ))}
      {reveal && (
        <RevealFooter
          g={g}
          state={state}
          dispatch={dispatch}
          sources={item.sources}
          solution={g.last?.ok ? <>+{g.last.points} INCASSATI</> : <>{item.chain[k]?.name}: {item.chain[k]?.label} · PIATTO PERSO</>}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------ La Decina */

function Members({ item, said }: { item: SetItem; said: { id: string }[] }) {
  const ids = new Set(said.map((s) => s.id));
  return (
    <div className="members">
      {item.members.map((m) => (
        <span key={m.id} className={ids.has(m.id) ? "said" : ""}>
          {m.name}
        </span>
      ))}
    </div>
  );
}

function Decina({ state, g, dispatch, ctx, start }: GameProps) {
  const { readonly } = usePlay();
  const item = g.item as SetItem;
  const final = g.stage === "final";
  const said = g.said as { id: string; name: string; player: PlayerIdx }[];
  return (
    <>
      <div className="q-card">
        <div className="q small">{item.title}</div>
        {item.description && <div className="sub">{item.description}</div>}
      </div>
      <TurnBar state={state} p={final ? null : g.turn} info={`${said.length}/10`}>
        {([0, 1] as const).filter((p) => !state.config.solo || p === 0).map((p) => (
          <span key={p} className={`lives ${pc(p)}`} title="errori rimasti">
            {g.out[p] ? "FUORI" : "♥".repeat(2 - g.errors[p]) + "♡".repeat(g.errors[p])}
          </span>
        ))}
      </TurnBar>
      <StateTimer state={state} start={start} />
      <div className="slots">
        {Array.from({ length: 10 }, (_, k) => (
          <div key={k} className={`chip ${said[k] ? pc(said[k]!.player) : "empty"}`}>
            {said[k]?.name ?? k + 1}
          </div>
        ))}
      </div>
      {g.stage === "ask" && (readonly ? <PhoneHint /> : <AnswerBox key={`${g.turn}-${said.length}-${g.errors.join()}`} index={ctx.index} prompt={item.title} timer={<StateTimer state={state} start={start} />} actions={<PassButton state={state} dispatch={dispatch} player={g.turn} />} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} />)}
      {g.stage === "ask" && !readonly && <PassButton state={state} dispatch={dispatch} player={g.turn} />}
      {g.stage === "feedback" && <Result last={g.last} players={namesOf(state)} />}
      {final && (
        <>
          <Members item={item} said={said} />
          <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ L'Asta */

function Asta({ state, g, dispatch, ctx, start }: GameProps) {
  const { readonly } = usePlay();
  const item = g.item as SetItem;
  const [amount, setAmount] = useState(1);
  const current = g.bid?.amount ?? 0;
  useEffect(() => setAmount(Math.min(g.max, current + 1)), [current, g.max, g.k]);
  return (
    <>
      <div className="q-card">
        <div className="q small">{item.title}</div>
        {item.description && <div className="sub">{item.description}</div>}
      </div>
      {g.stage === "bidding" && (
        <>
          <TurnBar state={state} p={g.turn} text="RILANCIA" info={`CATEGORIA ${g.k + 1}/${g.items.length}`} />
          <div className="row">
            <span className="px">PUNTATA ATTUALE</span>
            <span className={`led big ${current ? pc(g.bid.player) : ""}`}>{current || "–"}</span>
            {current > 0 && <span className={`px ${pc(g.bid.player)}`}>{state.config.players[g.bid.player as PlayerIdx]}</span>}
          </div>
          {readonly ? (
            <PhoneHint text="Si rilancia dal telefono" />
          ) : (
            <div className="bid">
              <button className="btn ghost sq" onClick={() => setAmount((a) => Math.max(current + 1, a - 1))}>
                −
              </button>
              <span className="led big">{amount}</span>
              <button className="btn ghost sq" onClick={() => setAmount((a) => Math.min(g.max, a + 1))}>
                +
              </button>
              <button className="btn" onClick={() => dispatch({ type: "BID", player: g.turn, amount })}>
                NE DICO {amount}
              </button>
              {!state.config.solo && (
                <button className="btn ko" onClick={() => dispatch({ type: "PASS", player: g.turn })}>
                  PASSO
                </button>
              )}
            </div>
          )}
        </>
      )}
      {g.stage === "proving" && (
        <>
          <TurnBar state={state} p={g.turn} text="DEVE DIRNE" info={`${g.said.length}/${g.bid.amount}`}>
            {!readonly && (
              <button className="btn small ko" onClick={() => dispatch({ type: "FINISH" })}>
                MI ARRENDO
              </button>
            )}
          </TurnBar>
          <StateTimer state={state} start={start} />
          <div className="slots">
            {Array.from({ length: g.bid.amount }, (_, k) => (
              <div key={k} className={`chip ${g.said[k] ? pc(g.turn) : "empty"}`}>
                {g.said[k]?.name ?? k + 1}
              </div>
            ))}
          </div>
          <WrongSaid text={g.wrong?.text} who={namesOf(state)[g.wrong?.player as PlayerIdx]} />
          {readonly ? <PhoneHint /> : <AnswerBox index={ctx.index} prompt={`${g.said.length}/${g.bid.amount} · ${item.title}`} timer={<StateTimer state={state} start={start} />} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} />}
        </>
      )}
      {g.stage === "reveal" && (
        <>
          <Members item={item} said={g.said} />
          <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ Dal Dischetto */

function Dischetto({ state, g, dispatch, ctx, start }: GameProps) {
  const { readonly } = usePlay();
  const item = g.item as DischettoItem;
  const final = g.stage === "final";
  const top = item.ranking.filter((r) => r.rank <= 10);
  const owners = new Map((g.said as { id: string; player: PlayerIdx }[]).map((s) => [s.id, s.player]));
  // Players tied at the last useful place share the places left in the top 10.
  const sure = top.filter((r) => r.rank < 10);
  const tied = top.filter((r) => r.rank === 10);
  const tiedSaid = (g.said as { id: string; name: string; player: PlayerIdx }[]).filter((x) => !sure.some((r) => r.id === x.id));
  const tiedRest = tied.filter((r) => !tiedSaid.some((x) => x.id === r.id));
  const places = Math.max(0, 10 - sure.length);
  const rows = [
    ...sure.map((r) => ({ pos: r.rank, value: r.value, label: r.label, name: owners.has(r.id) || final ? r.name : "", owner: r.id ? owners.get(r.id) : undefined })),
    ...Array.from({ length: Math.min(places, tied.length) }, (_, k) => {
      const hit = tiedSaid[k];
      const shown = hit ? tied.find((r) => r.id === hit.id) : final ? tiedRest[k - tiedSaid.length] : undefined;
      return { pos: sure.length + 1, value: tied[0]!.value, label: shown?.label ?? (tied.length === 1 ? tied[0]!.label : undefined), name: hit?.name ?? shown?.name ?? "", owner: hit?.player };
    }),
  ];
  const spare = final ? tiedRest.slice(Math.max(0, places - tiedSaid.length)) : [];
  return (
    <>
      <div className="q-card">
        <div className="q small">{item.title}</div>
        <div className="sub">
          {item.hint} {tied.length > places && `In ${tied.length} a pari merito per ${places === 1 ? "l'ultimo posto" : `gli ultimi ${places} posti`}. `}
          <span style={{ opacity: 0.7 }}>· {item.definition}</span>
        </div>
      </div>
      <TurnBar state={state} p={final ? null : g.turn} text="TIRA">
        {([0, 1] as const).filter((p) => !state.config.solo || p === 0).map((p) => (
          <span key={p} className={`kicks ${pc(p)}`}>
            {state.config.players[p]}
            {Array.from({ length: 5 }, (_, k) => (
              <i key={k} className={g.kicks[p][k] === undefined ? "" : g.kicks[p][k] ? "in" : "out"} />
            ))}
          </span>
        ))}
      </TurnBar>
      <StateTimer state={state} start={start} />
      <div className="ranking" style={{ gridTemplateRows: `repeat(${Math.ceil(rows.length / 2)}, auto)` }}>
        {rows.map((r, k) => (
          <div key={k} className={`rank ${r.owner !== undefined ? pc(r.owner) : r.name ? "shown" : "mystery"}`}>
            <span className="pos">{r.pos}</span>
            <span className="name">{r.name || "? ? ? ? ?"}</span>
            <span className="val">{r.value >= 0 ? r.label ?? `${r.value} ${item.unit}` : ""}</span>
          </div>
        ))}
      </div>
      {spare.length > 0 && <div className="sub">A pari merito, valevano anche: {spare.map((r) => r.name).join(", ")}.</div>}
      {g.stage === "ask" && (readonly ? <PhoneHint /> : <AnswerBox key={g.shots.join()} index={ctx.index} prompt={item.title} timer={<StateTimer state={state} start={start} />} actions={<PassButton state={state} dispatch={dispatch} player={g.turn} label="NON TIRO" />} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} submitLabel="TIRA!" />)}
      {g.stage === "ask" && !readonly && <PassButton state={state} dispatch={dispatch} player={g.turn} label="NON TIRO" />}
      {g.stage === "feedback" && (
        <>
          <div className={`shout ${g.last?.ok ? "c-ok" : "c-ko"}`}>{g.last?.ok ? "GOOOL!" : "PARATA!"}</div>
          {!g.last?.ok && <WrongSaid text={g.last?.said} who={namesOf(state)[g.last?.player as PlayerIdx]} />}
        </>
      )}
      {final && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />}
    </>
  );
}

/* ------------------------------------------------------------ La Formazione */

/** Nudge apart the players whose roles sit on the same spot, so names never overlap. */
function spread(players: FormazioneItem["teams"][0]["players"]): { x: number; y: number }[] {
  const pts = players.map((p) => ({ x: p.x, y: p.y }));
  const clamp = (v: number) => Math.min(0.97, Math.max(0.03, v));
  for (let n = 0; n < 12; n++) {
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const A = pts[a]!;
        const B = pts[b]!;
        const dx = Math.abs(A.x - B.x);
        if (Math.abs(A.y - B.y) >= 0.11 || dx >= 0.24) continue;
        const push = (0.24 - dx) / 2 + 0.004;
        const dir = A.x <= B.x ? -1 : 1;
        A.x = clamp(A.x + dir * push);
        B.x = clamp(B.x - dir * push);
      }
    }
  }
  return pts;
}

function Formazione({ state, g, dispatch, ctx, start }: GameProps) {
  const { readonly, pad } = usePlay();
  const item = g.item as FormazioneItem;
  if (g.stage === "choose") {
    return (
      <div className="splash">
        <div className="q-card">
          <div className="q">{item.title}</div>
          <div className="sub">
            {item.competition} · {item.date}
          </div>
        </div>
        <TurnBar state={state} p={g.starter} text="SCEGLIE LA SQUADRA:" />
        {readonly ? (
          <PhoneHint text="Si sceglie dal telefono" />
        ) : (
          <div className="row">
            {item.teams.map((t, k) => (
              <button key={k} className={`btn ${k === 0 ? "p1" : "p2"}`} onClick={() => dispatch({ type: "CHOOSE", value: k })}>
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  const team = item.teams[g.teamOf[g.turn] as 0 | 1];
  const reveal = g.stage === "reveal";
  const pts = spread(team.players);
  return (
    <div className="duo">
      {!pad && (
        <div className="pitch" key={g.round}>
          {team.players.map((p, k) => (
            <div key={k} className={`pl ${p.hidden ? (g.found.includes(p.id) ? "found" : reveal ? "" : "hidden") : ""}`} style={{ left: `${8 + pts[k]!.x * 84}%`, top: `${95 - pts[k]!.y * 92}%` }}>
              <div className="shirt">{p.number ?? ""}</div>
              {p.name ? p.name.split(" ").slice(-1)[0] : "???"}
            </div>
          ))}
        </div>
      )}
      <div className="side">
        <div className="q-card">
          <div className="q small">{item.title}</div>
          <div className="sub">
            {item.competition} · {item.date}
          </div>
          <div className="sub c-accent">
            {team.name} ({team.formation})
          </div>
        </div>
        <TurnBar state={state} p={g.turn} info={`TROVATI ${g.found.length}/5`} />
        <StateTimer state={state} start={start} />
        {g.stage === "play" &&
          (readonly ? (
            <PhoneHint />
          ) : (
            <>
              <WrongSaid text={g.wrong?.text} who={namesOf(state)[g.wrong?.player as PlayerIdx]} />
              <AnswerBox index={ctx.index} placeholder="Un titolare oscurato" prompt={`${team.name} (${team.formation}) · trovati ${g.found.length}/5 · ${item.title}`} timer={<StateTimer state={state} start={start} />} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} />
              <button className="btn ghost small" onClick={() => dispatch({ type: "FINISH" })}>
                HO FINITO
              </button>
            </>
          ))}
        {reveal && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ La Maglia */

function Maglia({ state, g, dispatch, start }: GameProps) {
  const { readonly, pad } = usePlay();
  const item = g.items[g.i] as MagliaItem;
  const reveal = g.stage === "reveal";
  const surname = item.player.split(" ").slice(1).join(" ") || item.player;
  return (
    <div className="duo">
      {!pad && (
        <div className={`shirt-big ${pc(g.turn)}`} key={g.i}>
          <svg viewBox="0 0 43 47" shapeRendering="crispEdges" aria-hidden>
            <path fill="currentColor" d="M10 0h8v3h7V0h8l10 9-6 8-5-3v33H11V14l-5 3-6-8z" />
            <path fill="rgba(0,0,0,.25)" d="M11 43h21v4H11z" />
            <path fill="#f2f2ff" d="M18 0h7v3h-7z" />
          </svg>
          <div className="back">
            <span className="surname">{surname.toUpperCase()}</span>
            <span className={`num ${reveal ? "pop" : "q"}`}>{reveal ? item.answer.display : "?"}</span>
          </div>
        </div>
      )}
      <div className="side">
        <TurnBar state={state} p={g.turn} info={`MAGLIA ${g.i + 1}/${g.items.length}`} />
        <StateTimer state={state} start={start} />
        <div className="q-card">
          <div className="q small">{item.question}</div>
        </div>
        {!reveal && (readonly ? <PhoneHint /> : <NumberPad key={g.i} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} />)}
        {reveal && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} solution={<>NUMERO {item.answer.display}</>} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ switch */

export function GameView(props: GameProps) {
  switch (props.g.game) {
    case "tiro_secco":
      return <TiroSecco {...props} />;
    case "decina":
      return <Decina {...props} />;
    case "asta":
      return <Asta {...props} />;
    case "dischetto":
      return <Dischetto {...props} />;
    case "formazione":
      return <Formazione {...props} />;
    case "maglia":
      return <Maglia {...props} />;
    case "testa_a_testa":
      return <TestaATesta {...props} />;
    default:
      return null;
  }
}

export const isBuzzerGame = (g: string) => g === "mercato" || g === "giramondo" || g === "quotazione";

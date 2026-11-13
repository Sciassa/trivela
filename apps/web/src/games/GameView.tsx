import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { AnomaliaItem, DischettoItem, FormazioneItem, FrameEvent, FrameItem, MagliaItem, PlayerIdx, SetItem, SourceRef, TiroSeccoItem } from "@trivela/protocol";
import type { EngineCtx, GameStateAny, Intent, MatchState } from "@trivela/engine";
import { AnswerBox, Copione, Fit, NextButton, NumberPad, PhoneHint, Result, StateTimer, usePlay, WrongSaid } from "../components/ui";
import { Sprite } from "../components/sprites";

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

/* ------------------------------------------------------------ Four-option quizzes: Tiro Secco, L'Anomalia, Il Frame */

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
  const item = g.items[g.i] as TiroSeccoItem | AnomaliaItem;
  const anomaly = g.game === "anomalia";
  return (
    <>
      <TurnBar state={state} p={g.turn} info={`DOMANDA ${g.i + 1}/${g.items.length}`} />
      <StateTimer state={state} start={start} />
      <div className="q-card" key={g.i}>
        {anomaly && <div className="anomaly-tag">⚠ RECORD BIZZARRO · {String((item as AnomaliaItem).kind).toUpperCase()}</div>}
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
    if (!readonly && canBuzz(p)) dispatch({ type: "BUZZ", player: p });
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
  return (
    <div className={`buzz-layout ${tableMode ? "table-mode" : ""} ${solo ? "solo" : ""}`}>
      {side(0)}
      <Fit>
        <div className="view">
          <div className="turnbar">
            <span className="who c-accent">
              <span>
                {g.game === "mercato" ? "TRASFERIMENTO" : "CARRIERA"} {g.i + 1}/{g.items.length}
              </span>
            </span>
            <span className="grow" />
            {g.stage === "ready" && <span className="px blink c-accent">PRONTI…</span>}
            {g.free && g.stage === "clues" && !readonly && (
              <button className="btn small ghost" onClick={() => dispatch({ type: "REVEAL_CLUE" })} disabled={g.revealed >= total}>
                SCOPRI INDIZIO
              </button>
            )}
          </div>
          <StateTimer state={state} start={start} />
          {g.game === "giramondo" && <div className="sub">Le squadre in ordine di primo arrivo, con l'anno.</div>}
          <div className="clues" key={g.i}>
            {Array.from({ length: total }, (_, k) => (
              <div key={k} className={`clue ${k < g.revealed ? "shown" : "hidden"} ${k === g.revealed - 1 && g.stage !== "reveal" ? "current" : ""}`}>
                <span className="pts">{points[k]} PT</span>
                {k < g.revealed || g.stage === "reveal" ? <ClueText text={item.clues[k]!} /> : <span>? ? ?</span>}
              </div>
            ))}
          </div>
          {g.stage === "clues" && g.last && !g.last.ok && (
            <WrongSaid text={g.last.said} who={namesOf(state)[g.last.player as PlayerIdx]} />
          )}
          {g.stage === "answering" && (
            <div className="col" style={{ gap: 10 }}>
              <TurnBar state={state} p={g.buzzer} text="RISPONDE" />
              {readonly ? <PhoneHint /> : <AnswerBox index={ctx.index} placeholder="Chi è?" onSubmit={(text) => dispatch({ type: "ANSWER", player: g.buzzer, payload: { text } })} />}
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
      {g.stage === "ask" && (readonly ? <PhoneHint /> : <AnswerBox key={`${g.turn}-${said.length}-${g.errors.join()}`} index={ctx.index} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} />)}
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
          {readonly ? <PhoneHint /> : <AnswerBox index={ctx.index} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} />}
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
      {g.stage === "ask" && (readonly ? <PhoneHint /> : <AnswerBox key={g.shots.join()} index={ctx.index} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} submitLabel="TIRA!" />)}
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
              <AnswerBox index={ctx.index} placeholder="Un titolare oscurato" onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} />
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

/* ------------------------------------------------------------ Il Frame */

const EVENT_LABEL: Record<FrameEvent["kind"], string> = { goal: "Gol", yellow: "Ammonizione", second_yellow: "Seconda ammonizione", red: "Espulsione" };

/** The anonymous timeline of an iconic match: goals (with the running score in `match` mode) and cards. */
function Timeline({ item }: { item: FrameItem }) {
  return (
    <div className="timeline">
      {item.events.map((e, k) => (
        <div key={k} className={`ev ${e.kind}`} style={{ "--i": k } as CSSProperties}>
          <span className="min">{e.minute}'</span>
          {e.kind === "goal" ? <Sprite name="ball" size={34} /> : <i className={`card ${e.kind}`} />}
          <span className="what">
            {EVENT_LABEL[e.kind]}
            {e.score && <b className="led-score">{e.score[0]}-{e.score[1]}</b>}
            {e.side !== undefined && <small> · {e.side === 0 ? "casa" : "ospite"}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Frame({ state, g, dispatch, start }: GameProps) {
  const { pad } = usePlay();
  const item = g.items[g.i] as FrameItem;
  const reveal = g.stage === "reveal";
  return (
    <div className="duo">
      <div className="side" style={pad ? undefined : { flex: "0 0 40%" }}>
        <div className="q-card" key={g.i}>
          <div className="q small">{item.heading}</div>
          <div className="sub">{item.mode === "match" ? "Cronologia di gol e cartellini" : "Gol e cartellini (solo i minuti)"}</div>
        </div>
        <Timeline item={item} />
      </div>
      <div className="side">
        <TurnBar state={state} p={g.turn} info={`PARTITA ${g.i + 1}/${g.items.length}`} />
        <StateTimer state={state} start={start} />
        <div className="q-card">
          <div className="q small">{item.question}</div>
        </div>
        <FourOptions key={`o${g.i}`} item={item} g={g} dispatch={dispatch} />
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
    case "anomalia":
      return <TiroSecco {...props} />;
    case "decina":
      return <Decina {...props} />;
    case "asta":
      return <Asta {...props} />;
    case "dischetto":
      return <Dischetto {...props} />;
    case "formazione":
      return <Formazione {...props} />;
    case "frame":
      return <Frame {...props} />;
    case "maglia":
      return <Maglia {...props} />;
    default:
      return null;
  }
}

export const isBuzzerGame = (g: string) => g === "mercato" || g === "giramondo";

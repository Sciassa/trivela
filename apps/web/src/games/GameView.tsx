import { useEffect, useState } from "react";
import type {
  CassaforteItem,
  DischettoItem,
  FiloRossoItem,
  FormazioneItem,
  FrameItem,
  IntrusoItem,
  MagliaItem,
  MappamondoItem,
  PlayerIdx,
  PrimaPaginaItem,
  SetItem,
  TiroSeccoItem,
} from "@trivela/protocol";
import type { EngineCtx, GameStateAny, Intent, MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";
import { AnswerBox, Copione, NextButton, PixelKeyboard, Result, ScorePicker, StateTimer } from "../components/ui";
import { Newspaper } from "../components/Newspaper";
import { WorldMap } from "../components/WorldMap";

export interface GameProps {
  state: MatchState;
  /** Redacted game state (what the screen may show). */
  g: GameStateAny;
  dispatch: (i: Intent) => void;
  ctx: EngineCtx;
  start: number;
  tableMode?: boolean;
}

const pc = (p: PlayerIdx | null | undefined) => (p === 0 ? "c-p1" : p === 1 ? "c-p2" : "");
const Turn = ({ state, p, text = "tocca a" }: { state: MatchState; p: PlayerIdx | null; text?: string }) =>
  p === null ? null : (
    <span className={`px ${pc(p)}`} style={{ fontSize: 18 }}>
      {text} {state.config.players[p]}
    </span>
  );

/* ------------------------------------------------------------ Tiro Secco */

function TiroSecco({ state, g, dispatch, start }: GameProps) {
  const item = g.items[g.i] as TiroSeccoItem;
  const reveal = g.stage === "reveal";
  const picked = Number(String(g.last?.detail ?? "").split(":")[1] ?? -1);
  useEffect(() => {
    if (reveal) return;
    const h = (e: KeyboardEvent) => {
      const k = "abcd1234".indexOf(e.key.toLowerCase());
      if (k >= 0) dispatch({ type: "ANSWER", payload: { choice: k % 4 } });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [reveal, dispatch]);
  return (
    <>
      <div className="row">
        <Turn state={state} p={g.turn} />
        <span className="grow" />
        <span className="dim">Domanda {g.i + 1}/8</span>
      </div>
      <StateTimer state={state} start={start} />
      <div className="question">{item.question}</div>
      <div className="options">
        {item.options.map((o, k) => (
          <button
            key={k}
            className={`option ${reveal && k === item.correct ? "right" : ""} ${reveal && k === picked && k !== item.correct ? "wrongpick" : ""}`}
            disabled={reveal}
            onClick={() => dispatch({ type: "ANSWER", payload: { choice: k } })}
          >
            <span className="key">{"ABCD"[k]}</span>
            {o}
          </button>
        ))}
      </div>
      {reveal && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />}
    </>
  );
}

function RevealFooter({ g, state, dispatch, sources, extra }: { g: GameStateAny; state: MatchState; dispatch: (i: Intent) => void; sources?: { family: string; label: string; url: string }[]; extra?: React.ReactNode }) {
  return (
    <>
      <div className="row">
        <Result last={g.last} players={state.config.players} />
        {extra}
        <span className="grow" />
        <NextButton onClick={() => dispatch({ type: "NEXT" })} />
      </div>
      <Copione text={g.script} sources={sources} />
    </>
  );
}

/* ------------------------------------------------------------ Prima Pagina */

function PrimaPagina({ state, g, dispatch, start }: GameProps) {
  const item = g.items[g.turn] as PrimaPaginaItem;
  const reveal = g.stage === "reveal";
  const [vals, setVals] = useState(["", ""]);
  const [focus, setFocus] = useState(0);
  useEffect(() => setVals(["", ""]), [g.turn]);
  const onKey = (k: string) => {
    audio.play("blip");
    setVals((v) => {
      const n = [...v];
      if (k === "⌫") n[focus] = n[focus]!.slice(0, -1);
      else if (k === "⏎") setFocus((f) => (f + 1) % 2);
      else n[focus] += k;
      return n;
    });
  };
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 30, flex: 1, minHeight: 0 }}>
      <div style={{ width: 900, maxHeight: 720, overflow: "hidden" }}>
        <Newspaper page={item.page} slots={item.slots} revealed={reveal} />
      </div>
      <div className="col grow">
        <Turn state={state} p={g.turn} />
        <StateTimer state={state} start={start} />
        {item.slots.map((sl, k) => (
          <div key={k} className="field">
            <label>
              {k + 1}. {sl.label}
            </label>
            {reveal ? (
              <div className="px c-ok" style={{ fontSize: 16 }}>
                {sl.answer.display}
              </div>
            ) : (
              <input className="input" value={vals[k]} onFocus={() => setFocus(k)} onChange={(e) => setVals((v) => v.map((x, i) => (i === k ? e.target.value : x)))} style={{ borderColor: focus === k ? "var(--accent)" : undefined }} />
            )}
          </div>
        ))}
        {!reveal && (
          <>
            <PixelKeyboard onKey={onKey} compact />
            <button className="btn" onClick={() => dispatch({ type: "ANSWER", payload: { texts: vals } })}>
              INVIA
            </button>
          </>
        )}
        {reveal && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Buzzer games */

export function ClueBuzzer({ state, g, dispatch, ctx, start, tableMode }: GameProps) {
  const item = g.items[g.i] as { clues: string[]; answer: { display: string }; script: string; sources: never[] };
  const points: number[] = g.points;
  const total = g.game === "mercato" ? 6 : 5;
  const [hit, setHit] = useState<PlayerIdx | null>(null);
  const canBuzz = (p: PlayerIdx) => (g.stage === "clues" || g.stage === "ready") && !g.out[p];
  const buzz = (p: PlayerIdx) => {
    if (!canBuzz(p)) return;
    setHit(p);
    dispatch({ type: "BUZZ", player: p });
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "a") buzz(0);
      if (e.key.toLowerCase() === "l") buzz(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  const side = (p: PlayerIdx) => (
    <button
      className={`buzz-btn ${p === 0 ? "p1" : "p2"} ${hit === p && g.stage === "answering" ? "hit" : ""}`}
      disabled={!canBuzz(p)}
      onPointerDown={(e) => {
        e.preventDefault();
        buzz(p);
      }}
    >
      <span>
        {state.config.players[p]}
        <br />
        <br />
        {g.out[p] ? "FUORI" : "PREMI!"}
        <br />
        <small style={{ fontSize: 10 }}>{p === 0 ? "[tasto A]" : "[tasto L]"}</small>
      </span>
    </button>
  );
  return (
    <div className={`buzz-layout ${tableMode ? "table-mode" : ""}`}>
      {side(0)}
      <div className="buzz-center">
        <div className="row">
          <span className="px c-accent" style={{ fontSize: 16 }}>
            PROFILO {g.i + 1}/{g.items.length}
          </span>
          <span className="grow" />
          {g.stage === "ready" && <span className="px blink">PRONTI...</span>}
          {g.free && g.stage === "clues" && (
            <button className="btn ghost" onClick={() => dispatch({ type: "REVEAL_CLUE" })} disabled={g.revealed >= total}>
              SCOPRI INDIZIO
            </button>
          )}
        </div>
        <StateTimer state={state} start={start} />
        {Array.from({ length: total }, (_, k) => (
          <div key={k} className={`clue ${k >= g.revealed ? "hidden" : ""}`}>
            <span className="pts">{points[k]} pt</span>
            <span>{k < g.revealed ? item.clues[k] : "▒▒▒▒▒▒▒▒▒▒"}</span>
          </div>
        ))}
        {g.stage === "answering" && (
          <div className="col" style={{ gap: 8 }}>
            <Turn state={state} p={g.buzzer} text="risponde" />
            <AnswerBox index={ctx.index} onSubmit={(text) => dispatch({ type: "ANSWER", player: g.buzzer, payload: { text } })} keyboard={false} />
          </div>
        )}
        {g.stage === "reveal" && (
          <>
            <div className="question c-ok">{item.answer.display}</div>
            <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />
          </>
        )}
      </div>
      {side(1)}
    </div>
  );
}

/* ------------------------------------------------------------ Decina / Asta lists */

function Decina({ state, g, dispatch, ctx, start }: GameProps) {
  const item = g.item as SetItem;
  const final = g.stage === "final";
  const said = g.said as { id: string; name: string; player: PlayerIdx }[];
  return (
    <>
      <div className="question">{item.title}</div>
      <div className="dim">{item.description}</div>
      <div className="row">
        <Turn state={state} p={g.turn} />
        <span className="grow" />
        <span className="px" style={{ fontSize: 14 }}>
          {said.length}/10 · errori {g.errors[0]}-{g.errors[1]}
        </span>
      </div>
      <StateTimer state={state} start={start} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
        {Array.from({ length: 10 }, (_, k) => (
          <div key={k} className={`chip ${said[k] ? pc(said[k]!.player) : "dim"}`} style={{ fontFamily: "var(--term)", fontSize: 24, minHeight: 50 }}>
            {said[k]?.name ?? `${k + 1}.`}
          </div>
        ))}
      </div>
      {g.stage === "ask" && <AnswerBox index={ctx.index} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} keyboard={false} />}
      {g.stage === "feedback" && <Result last={g.last} players={state.config.players} />}
      {final && (
        <>
          <div className="dim">Tutte le risposte valide: {item.members.map((m) => m.name).join(", ")}</div>
          <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />
        </>
      )}
    </>
  );
}

function Asta({ state, g, dispatch, ctx, start }: GameProps) {
  const item = g.item as SetItem;
  const [amount, setAmount] = useState(1);
  const current = g.bid?.amount ?? 0;
  useEffect(() => setAmount(Math.min(g.max, current + 1)), [current, g.max]);
  return (
    <>
      <div className="question">{item.title}</div>
      <div className="dim">
        {item.description} · risposte valide: {item.members.length || "?"}
      </div>
      {g.stage === "bidding" && (
        <div className="col">
          <Turn state={state} p={g.turn} text="rilancia" />
          <div className="px" style={{ fontSize: 20 }}>
            Puntata attuale: {current ? `${current} (${state.config.players[g.bid.player as 0 | 1]})` : "nessuna"}
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => setAmount((a) => Math.max(current + 1, a - 1))}>
              −
            </button>
            <span className="px" style={{ fontSize: 48, minWidth: 90, textAlign: "center" }}>
              {amount}
            </span>
            <button className="btn ghost" onClick={() => setAmount((a) => Math.min(g.max, a + 1))}>
              +
            </button>
            <button className="btn" onClick={() => dispatch({ type: "BID", player: g.turn, amount })}>
              NE DICO {amount}
            </button>
            <button className="btn ko" onClick={() => dispatch({ type: "PASS", player: g.turn })}>
              PASSO
            </button>
          </div>
        </div>
      )}
      {g.stage === "proving" && (
        <>
          <div className="row">
            <Turn state={state} p={g.turn} text="deve dirne" />
            <span className="px c-accent">
              {g.said.length}/{g.bid.amount}
            </span>
            <span className="grow" />
            <button className="btn ko" onClick={() => dispatch({ type: "FINISH" })}>
              MI ARRENDO
            </button>
          </div>
          <StateTimer state={state} start={start} />
          <div className="row" style={{ flexWrap: "wrap" }}>
            {(g.said as { name: string }[]).map((s) => (
              <span key={s.name} className={`chip ${pc(g.turn)}`}>
                {s.name}
              </span>
            ))}
          </div>
          <AnswerBox index={ctx.index} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} keyboard={false} />
        </>
      )}
      {g.stage === "reveal" && (
        <>
          <div className="dim">Risposte valide: {item.members.map((m) => m.name).join(", ")}</div>
          <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ Dal Dischetto */

function Dischetto({ state, g, dispatch, ctx, start }: GameProps) {
  const item = g.item as DischettoItem;
  const final = g.stage === "final";
  const top = item.ranking.filter((r) => r.rank <= 10);
  const first = top.find((r) => r.rank === 1);
  const tenth = top.find((r) => r.rank === 10);
  const said = new Map((g.said as { id: string; player: PlayerIdx }[]).map((s) => [s.id, s.player]));
  return (
    <>
      <div className="question">{item.title}</div>
      <div className="dim">
        {item.definition} · Il 1° ha {first?.value} {item.unit}, il 10° ne ha {tenth?.value}.
      </div>
      <div className="row">
        <Turn state={state} p={g.turn} text="tira" />
        <span className="grow" />
        {[0, 1].map((p) => (
          <span key={p} className={`px ${pc(p as PlayerIdx)}`} style={{ fontSize: 16 }}>
            {state.config.players[p]}: {(g.kicks[p] as boolean[]).map((k) => (k ? "●" : "○")).join("")}
            {"·".repeat(5 - g.kicks[p].length)}
          </span>
        ))}
      </div>
      <StateTimer state={state} start={start} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(final ? item.ranking.filter((r) => r.rank <= 10) : top).map((r, k) => {
          const owner = said.get(r.id);
          return (
            <div key={k} className={`chip ${owner !== undefined ? pc(owner) : ""}`} style={{ fontFamily: "var(--term)", fontSize: 24 }}>
              {r.rank}. {owner !== undefined || final ? `${r.name} (${r.value})` : "▒▒▒▒▒▒"}
            </div>
          );
        })}
      </div>
      {g.stage === "ask" && <AnswerBox index={ctx.index} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} keyboard={false} submitLabel="TIRA!" />}
      {g.stage === "feedback" && <div className={`px ${g.last?.ok ? "c-ok" : "c-ko"}`}>{g.last?.ok ? "GOOOL!" : "PARATA!"}</div>}
      {final && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />}
    </>
  );
}

/* ------------------------------------------------------------ La Formazione */

function Formazione({ state, g, dispatch, ctx, start }: GameProps) {
  const item = g.item as FormazioneItem;
  if (g.stage === "choose") {
    return (
      <div className="col center" style={{ flex: 1 }}>
        <div className="question">{item.title}</div>
        <div className="dim">
          {item.competition} · {item.date}
        </div>
        <Turn state={state} p={g.starter} text="sceglie la squadra:" />
        <div className="row">
          {item.teams.map((t, k) => (
            <button key={t.id} className={`btn ${k === 0 ? "p1" : "p2"}`} onClick={() => dispatch({ type: "CHOOSE", value: k })}>
              {t.name}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const team = item.teams[g.teamOf[g.turn] as 0 | 1];
  const reveal = g.stage === "reveal";
  return (
    <div className="row" style={{ alignItems: "stretch", flex: 1, gap: 30 }}>
      <div className="pitch" style={{ width: 760, height: 690 }}>
        {team.players.map((p, k) => (
          <div key={k} className={`pl ${p.hidden ? (g.found.includes(p.id) ? "found" : "hidden") : ""}`} style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%` }}>
            <div className="shirt">{p.number ?? ""}</div>
            {p.name || "???"}
          </div>
        ))}
      </div>
      <div className="col grow">
        <div className="question" style={{ fontSize: 34 }}>
          {item.title}
        </div>
        <div className="dim">
          {item.competition} · {item.date} · {team.name}
        </div>
        <Turn state={state} p={g.turn} />
        <StateTimer state={state} start={start} />
        {g.stage === "play" && (
          <>
            <div className="px c-accent">TROVATI {g.found.length}/5</div>
            <AnswerBox index={ctx.index} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} keyboard={false} />
            <button className="btn ghost" onClick={() => dispatch({ type: "FINISH" })}>
              HO FINITO
            </button>
          </>
        )}
        {reveal && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ La Cassaforte */

const LEVELS = ["", "FACILE", "MEDIA", "DIFFICILE"];

function Cassaforte({ state, g, dispatch, ctx, start }: GameProps) {
  const picker = g.picks[g.k] as PlayerIdx;
  const [parts, setParts] = useState<string[]>([]);
  useEffect(() => setParts([]), [g.k]);
  if (g.stage === "choose") {
    return (
      <div className="col center" style={{ flex: 1 }}>
        <div className="dim">Argomento: {state.topics[picker].summary || state.topics[picker].text}</div>
        <Turn state={state} p={picker} text="scegli la domanda," />
        <div className="row">
          {[1, 2, 3].map((l) => (
            <button key={l} className={`btn ${l === 1 ? "ok" : l === 3 ? "ko" : ""}`} disabled={(g.chosen[picker] as number[]).includes(l)} onClick={() => dispatch({ type: "CHOOSE", value: l })}>
              {LEVELS[l]}
              <br />
              <small>
                +{l * 10} / −{40 - l * 10}
              </small>
            </button>
          ))}
        </div>
      </div>
    );
  }
  const item = g.current.item as CassaforteItem;
  const n = Math.max(1, item.parts.length || (g.current.level === 3 ? parts.length || 1 : 1));
  const need = item.parts.length || n;
  return (
    <>
      <div className="row">
        <Turn state={state} p={picker} />
        <span className="chip c-accent">{LEVELS[g.current.level]}</span>
      </div>
      <StateTimer state={state} start={start} />
      <div className="question">{item.question}</div>
      {g.stage === "ask" && (
        <div className="col">
          {parts.length > 0 && <div className="dim">Già scritto: {parts.join(" · ")}</div>}
          <AnswerBox
            index={ctx.index}
            keyboard={false}
            submitLabel={parts.length + 1 < need || /\b(e|due)\b/i.test(item.question) ? "AGGIUNGI" : "INVIA"}
            onSubmit={(text) => {
              const next = [...parts, text];
              const twoParts = /\b(due|entrambi|i due)\b/i.test(item.question);
              if (twoParts && next.length < 2) setParts(next);
              else dispatch({ type: "ANSWER", payload: { texts: next } });
            }}
          />
        </div>
      )}
      {g.stage === "reveal" && (
        <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} extra={<span className="px c-ok">{item.parts.map((p) => p.display).join(" + ")}</span>} />
      )}
    </>
  );
}

/* ------------------------------------------------------------ Il Frame */

function Frame({ state, g, dispatch, ctx, start }: GameProps) {
  const item = g.items[g.i] as FrameItem;
  const [scorer, setScorer] = useState("");
  useEffect(() => setScorer(""), [g.i]);
  const reveal = g.stage === "reveal";
  return (
    <>
      <div className="row">
        <Turn state={state} p={g.turn} />
        <span className="grow" />
        <span className="dim">{item.date}</span>
      </div>
      <StateTimer state={state} start={start} />
      <div className="question">
        {item.match}: qual era il risultato al <span className="c-accent">{item.minute}'</span>?
      </div>
      {!reveal && (
        <ScorePicker teams={item.teams} onSubmit={(score) => dispatch({ type: "ANSWER", payload: { score, scorer } })}>
          {item.lastScorer && (
            <div className="field">
              <label>BONUS: chi aveva segnato l'ultimo gol prima di quel minuto? (facoltativo)</label>
              <input className="input" value={scorer} onChange={(e) => setScorer(e.target.value)} />
            </div>
          )}
        </ScorePicker>
      )}
      {reveal && (
        <RevealFooter
          g={g}
          state={state}
          dispatch={dispatch}
          sources={item.sources}
          extra={
            <span className="px c-ok">
              {item.scoreAt[0]}-{item.scoreAt[1]}
              {item.lastScorer ? ` · ${item.lastScorer.display}` : ""}
            </span>
          }
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------ L'Intruso */

function Intruso({ state, g, dispatch, start }: GameProps) {
  const item = g.items[g.i] as IntrusoItem;
  const reveal = g.stage === "reveal";
  const phase = g.phase as 0 | 1;
  return (
    <>
      <div className="row">
        <Turn state={state} p={g.turn} />
        <span className="grow" />
        <span className="dim">{reveal ? "" : phase === 0 ? "Chi è l'intruso?" : "Qual è il legame tra gli altri tre?"}</span>
      </div>
      <StateTimer state={state} start={start} />
      <div className="options">
        {item.names.map((n, k) => (
          <button key={k} className={`option ${reveal && k === item.intruder ? "wrongpick" : ""}`} disabled={phase !== 0 || reveal} onClick={() => dispatch({ type: "ANSWER", payload: { choice: k } })}>
            <span className="key">{"ABCD"[k]}</span>
            {n}
          </button>
        ))}
      </div>
      {(phase === 1 || reveal) && (
        <div className="col" style={{ gap: 10 }}>
          {item.links.map((l, k) => (
            <button key={k} className={`option ${reveal && k === item.correctLink ? "right" : ""}`} style={{ fontSize: 28, minHeight: 56 }} disabled={reveal} onClick={() => dispatch({ type: "ANSWER", payload: { choice: k } })}>
              <span className="key">{k + 1}</span>
              {l}
            </button>
          ))}
        </div>
      )}
      {reveal && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />}
    </>
  );
}

/* ------------------------------------------------------------ Il Filo Rosso */

function FiloRosso({ state, g, dispatch, ctx, start }: GameProps) {
  const item = g.items[g.i] as FiloRossoItem;
  const [chain, setChain] = useState<string[]>([]);
  useEffect(() => setChain([]), [g.i]);
  const reveal = g.stage === "reveal";
  return (
    <>
      <div className="row">
        <Turn state={state} p={g.turn} />
      </div>
      <StateTimer state={state} start={start} />
      <div className="question">
        <span className="c-p1">{item.from.name}</span> → … → <span className="c-p2">{item.to.name}</span>
      </div>
      <div className="dim">Compagni di squadra nella stessa rosa (stesso torneo). Catena più corta: {item.optimal} passaggi.</div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="chip c-p1">{item.from.name}</span>
        {chain.map((c, k) => (
          <span key={k} className="chip" onClick={() => setChain(chain.filter((_, i) => i !== k))}>
            {c} ✕
          </span>
        ))}
        <span className="chip c-p2">{item.to.name}</span>
      </div>
      {!reveal && (
        <>
          <AnswerBox index={ctx.index} onSubmit={(t) => setChain([...chain, t])} keyboard={false} submitLabel="AGGIUNGI" />
          <button className="btn" onClick={() => dispatch({ type: "ANSWER", payload: { chain } })}>
            CHIUDI LA CATENA
          </button>
        </>
      )}
      {reveal && (
        <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} extra={<span className="dim">Soluzione: {item.solution.map((s) => s.name).join(" → ")}</span>} />
      )}
    </>
  );
}

/* ------------------------------------------------------------ Il Mappamondo */

function Mappamondo({ state, g, dispatch, start }: GameProps) {
  const item = g.items[g.i] as MappamondoItem;
  const reveal = g.stage === "reveal";
  return (
    <>
      <div className="row">
        <Turn state={state} p={g.turn} />
        <span className="grow" />
        {reveal && <span className="px c-accent">{String(g.last?.detail ?? "").replace("km:", "")} km</span>}
      </div>
      <StateTimer state={state} start={start} />
      <div className="question" style={{ fontSize: 36 }}>
        {item.question}
      </div>
      <WorldMap key={g.i} disabled={reveal} target={reveal ? item.target : null} onConfirm={(p) => dispatch({ type: "ANSWER", payload: { lat: p.lat, lon: p.lon } })} />
      {reveal && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} />}
    </>
  );
}

/* ------------------------------------------------------------ La Maglia */

function Maglia({ state, g, dispatch, ctx, start }: GameProps) {
  const item = g.items[g.i] as MagliaItem;
  const reveal = g.stage === "reveal";
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 40 }}>
      <div className="center" style={{ width: 300, height: 300, background: "var(--ink)", color: "var(--bg)", clipPath: "polygon(25% 0, 75% 0, 100% 18%, 88% 32%, 82% 26%, 82% 100%, 18% 100%, 18% 26%, 12% 32%, 0 18%)" }}>
        <span className="px" style={{ fontSize: 110 }}>
          {item.number}
        </span>
      </div>
      <div className="col grow">
        <Turn state={state} p={g.turn} />
        <StateTimer state={state} start={start} />
        <div className="question">
          {item.team}, {item.season}: chi indossava il numero {item.number}?
        </div>
        {!reveal && <AnswerBox index={ctx.index} onSubmit={(text) => dispatch({ type: "ANSWER", payload: { text } })} keyboard={false} />}
        {reveal && <RevealFooter g={g} state={state} dispatch={dispatch} sources={item.sources} extra={<span className="px c-ok">{item.answer.display}</span>} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ switch */

export function GameView(props: GameProps) {
  switch (props.g.game) {
    case "tiro_secco":
      return <TiroSecco {...props} />;
    case "prima_pagina":
      return <PrimaPagina {...props} />;
    case "decina":
      return <Decina {...props} />;
    case "asta":
      return <Asta {...props} />;
    case "dischetto":
      return <Dischetto {...props} />;
    case "formazione":
      return <Formazione {...props} />;
    case "cassaforte":
      return <Cassaforte {...props} />;
    case "frame":
      return <Frame {...props} />;
    case "intruso":
      return <Intruso {...props} />;
    case "filo_rosso":
      return <FiloRosso {...props} />;
    case "mappamondo":
      return <Mappamondo {...props} />;
    case "maglia":
      return <Maglia {...props} />;
    default:
      return null;
  }
}

export const isBuzzerGame = (g: string) => g === "mercato" || g === "giramondo";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import type { EngineCtx, GameStateAny, MatchState } from "@trivela/engine";
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
  Packs,
  SetItem,
  TiroSeccoItem,
} from "@trivela/protocol";
import { audio } from "@trivela/audio";
import { useRoom, type Role } from "../runtime/room";
import { MatchShell } from "./LocalMatch";
import { TopicField } from "./Setup";
import { AnswerBox, RotateOverlay, ScorePicker, useWakeLock } from "../components/ui";
import { GameView } from "../games/GameView";
import { WorldMap } from "../components/WorldMap";
import { GAME_NAMES } from "../rules";

function joinUrl(code: string, role: Role) {
  return `${location.origin}${location.pathname}#/join/${code}?r=${role}`;
}

function Qr({ url, label, color }: { url: string; label: string; color: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#0b0b1a", light: "#f2f2ff" } }).then(setSrc);
  }, [url]);
  return (
    <div className="col center" style={{ gap: 8 }}>
      {src && <img src={src} width={220} height={220} alt={`QR ${label}`} style={{ imageRendering: "pixelated", border: `6px solid ${color}` }} />}
      <span className="px" style={{ fontSize: 13, color }}>
        {label}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ Screen */

export function RoomScreen({ packs, ctx, onBack }: { packs: Packs; ctx: EngineCtx; onBack: () => void }) {
  const room = useRoom("screen");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [year, setYear] = useState("");
  useWakeLock(true);
  void packs;
  if (room.state) {
    return (
      <div className="readonly-wrap">
        <MatchShell state={room.state} dispatch={room.dispatch} ctx={ctx} start={room.timerStart} onExit={onBack} readonly={room.roster.host || room.roster.p1 || room.roster.p2} />
      </div>
    );
  }
  return (
    <div className="phone-ui" style={{ maxWidth: 1200 }}>
      <div className="row">
        <button className="btn ghost" onClick={onBack}>
          ◀
        </button>
        <span className="px c-accent" style={{ fontSize: 22 }}>
          STANZA {room.code || "…"}
        </span>
        <span className="grow" />
        <span className={room.connected ? "c-ok" : "c-ko"}>{room.connected ? "connesso" : "server non raggiungibile"}</span>
      </div>
      {!room.connected && (
        <div className="panel">
          {location.hostname.endsWith("github.io")
            ? "Su GitHub Pages c'è solo la versione a schermo singolo: per Regia e pulsantiere apri l'app dal server gratuito avviato sul PC (pnpm build && pnpm server) e usa l'indirizzo che stampa, con tutti i dispositivi sulla stessa Wi-Fi."
            : "Per giocare su più dispositivi avvia il server gratuito sul PC (pnpm build && pnpm server) e apri l'indirizzo mostrato su tutti i dispositivi della stessa Wi-Fi."}
        </div>
      )}
      {room.code && (
        <div className="row" style={{ justifyContent: "space-around", flexWrap: "wrap" }}>
          <Qr url={joinUrl(room.code, "host")} label={`REGIA ${room.roster.host ? "✔" : ""}`} color="var(--accent)" />
          <Qr url={joinUrl(room.code, "p1")} label={`PULSANTIERA 1 ${room.roster.p1 ? "✔" : ""}`} color="var(--p1)" />
          <Qr url={joinUrl(room.code, "p2")} label={`PULSANTIERA 2 ${room.roster.p2 ? "✔" : ""}`} color="var(--p2)" />
        </div>
      )}
      <div className="dim">Modalità A: collega la Regia (il conduttore valida le risposte a voce). Modalità B: collega le due pulsantiere.</div>
      <div className="row">
        <input className="input" placeholder="Giocatore 1" value={p1} onChange={(e) => setP1(e.target.value)} style={{ borderColor: "var(--p1)" }} />
        <input className="input" placeholder="Giocatore 2" value={p2} onChange={(e) => setP2(e.target.value)} style={{ borderColor: "var(--p2)" }} />
        <input className="input" placeholder="Dal anno (facolt.)" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ maxWidth: 260 }} />
      </div>
      <TopicField label="ARGOMENTO GIOCATORE 1" value={t1} onChange={setT1} ctx={ctx} color="var(--p1)" />
      <TopicField label="ARGOMENTO GIOCATORE 2" value={t2} onChange={setT2} ctx={ctx} color="var(--p2)" />
      {room.error && <div className="c-ko">{room.error}</div>}
      <button
        className="btn"
        disabled={!room.connected || !t1.trim() || !t2.trim()}
        onClick={() =>
          room.setup({ players: [p1 || "Giocatore 1", p2 || "Giocatore 2"], yearFrom: year ? Number(year) : null, topics: [t1, t2] })
        }
      >
        CREA LA PARTITA ▶
      </button>
    </div>
  );
}

export function RoomJoin() {
  const [code, setCode] = useState("");
  return (
    <div className="phone-ui">
      <div className="px c-accent">ENTRA IN UNA STANZA</div>
      <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))} placeholder="CODICE" />
      {(["host", "p1", "p2"] as const).map((r) => (
        <button key={r} className="btn" disabled={code.length !== 4} onClick={() => (location.hash = `#/join/${code}?r=${r}`)}>
          {r === "host" ? "REGIA" : r === "p1" ? "PULSANTIERA 1" : "PULSANTIERA 2"}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Shared phone frame */

function PhoneFrame({ title, room, children }: { title: string; room: ReturnType<typeof useRoom>; children: ReactNode }) {
  const s = room.state;
  return (
    <div className="need-portrait" style={{ minHeight: "100%" }}>
      <RotateOverlay to="verticale" />
      <div className="phone-ui">
        <div className="row">
          <span className="px c-accent" style={{ fontSize: 12 }}>
            {title} · {room.code}
          </span>
          <span className="grow" />
          <span className={room.connected ? "c-ok" : "c-ko"}>{room.connected ? "●" : "○"}</span>
        </div>
        {s && (
          <div className="row px" style={{ fontSize: 14, justifyContent: "space-between" }}>
            <span className="c-p1">
              {s.config.players[0]} {s.scores[0]}
            </span>
            <span className="dim">{s.order[s.gameIdx] ? GAME_NAMES[s.order[s.gameIdx]!] : ""}</span>
            <span className="c-p2">
              {s.scores[1]} {s.config.players[1]}
            </span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Host (Regia) */

function solutionOf(g: GameStateAny): string[] {
  switch (g.game) {
    case "tiro_secco": {
      const it = g.items[g.i] as TiroSeccoItem;
      return [it.question, `Risposta: ${"ABCD"[it.correct]}) ${it.options[it.correct]}`];
    }
    case "prima_pagina": {
      const it = g.items[g.turn] as PrimaPaginaItem;
      return it.slots.map((s, k) => `${k + 1}. ${s.label}: ${s.answer.display}`);
    }
    case "mercato":
    case "giramondo": {
      const it = g.items[g.i] as { answer: { display: string }; clues: string[] };
      return [`Risposta: ${it.answer.display}`, ...it.clues.map((c, k) => `${k + 1}. ${c}`)];
    }
    case "decina":
    case "asta":
      return [(g.item as SetItem).title, `${(g.item as SetItem).members.length} risposte valide`];
    case "dischetto":
      return (g.item as DischettoItem).ranking.filter((r) => r.rank <= 10).map((r) => `${r.rank}. ${r.name} (${r.value})`);
    case "formazione": {
      const it = g.item as FormazioneItem;
      return it.teams.map((t) => `${t.name}: ${t.players.filter((p) => p.hidden).map((p) => p.name).join(", ")}`);
    }
    case "cassaforte":
      return g.current ? [(g.current.item as CassaforteItem).question, `Risposta: ${(g.current.item as CassaforteItem).parts.map((p) => p.display).join(" + ")}`] : [];
    case "frame": {
      const it = g.items[g.i] as FrameItem;
      return [`${it.match} al ${it.minute}': ${it.scoreAt.join("-")}`, it.lastScorer ? `Ultimo marcatore: ${it.lastScorer.display}` : ""];
    }
    case "intruso": {
      const it = g.items[g.i] as IntrusoItem;
      return [`Intruso: ${it.names[it.intruder]}`, `Legame: ${it.links[it.correctLink]}`];
    }
    case "filo_rosso": {
      const it = g.items[g.i] as FiloRossoItem;
      return [`Catena ottimale (${it.optimal}): ${it.solution.map((x) => x.name).join(" → ")}`];
    }
    case "mappamondo": {
      const it = g.items[g.i] as MappamondoItem;
      return [it.question, `Risposta: ${it.target.label}`];
    }
    case "maglia": {
      const it = g.items[g.i] as MagliaItem;
      return [`${it.team} ${it.season} n.${it.number}: ${it.answer.display}`];
    }
  }
  return [];
}

function scriptOf(g: GameStateAny): string {
  if (g.script) return g.script;
  const it = g.game === "cassaforte" ? g.current?.item : g.item ?? (g.game === "prima_pagina" ? g.items?.[g.turn] : g.items?.[g.i]);
  return it?.script ?? "";
}

export function HostRoom({ code, ctx }: { code: string; ctx: EngineCtx }) {
  const room = useRoom("host", code);
  useWakeLock(true);
  const s = room.state;
  const d = room.dispatch;
  const [sel, setSel] = useState<string[]>([]);
  const [slots, setSlots] = useState([false, false]);
  const [bonus, setBonus] = useState(false);
  const g = s?.game;
  useEffect(() => {
    setSel([]);
    setSlots([false, false]);
    setBonus(false);
  }, [g?.i, g?.round, g?.k, g?.turn, g?.stage]);
  if (!s) {
    return (
      <PhoneFrame title="REGIA" room={room}>
        <div className="panel">In attesa che lo Schermo crei la partita…</div>
      </PhoneFrame>
    );
  }
  const Btn = ({ label, onClick, cls = "" }: { label: string; onClick: () => void; cls?: string }) => (
    <button className={`btn ${cls}`} onClick={() => (audio.play("blip"), onClick())}>
      {label}
    </button>
  );
  const ok = <Btn label="✓ ESATTA" cls="ok" onClick={() => d({ type: "VERDICT", payload: { correct: true } })} />;
  const ko = <Btn label="✗ SBAGLIATA" cls="ko" onClick={() => d({ type: "VERDICT", payload: { correct: false } })} />;
  let controls: ReactNode = null;
  if (s.phase === "draw") controls = <Btn label="INIZIA ▶" onClick={() => d({ type: "START" })} />;
  else if (s.phase === "intro") controls = <Btn label="VIA AL GIOCO ▶" onClick={() => d({ type: "BEGIN_GAME" })} />;
  else if (s.phase === "game_over") controls = <Btn label="PROSSIMO GIOCO ▶" onClick={() => d({ type: "NEXT" })} />;
  else if (s.phase === "match_over") controls = <div className="px c-accent">PARTITA FINITA</div>;
  else if (g) {
    const reveal = ["reveal", "final"].includes(g.stage);
    const next = <Btn label="AVANTI ▶" onClick={() => d({ type: "NEXT" })} />;
    if (reveal) controls = next;
    else
      switch (g.game) {
        case "tiro_secco":
        case "intruso": {
          const it = g.items[g.i] as TiroSeccoItem | IntrusoItem;
          const opts = "options" in it ? it.options : g.phase === 0 ? it.names : it.links;
          controls = opts.map((o: string, k: number) => <Btn key={k} label={`${"ABCD"[k]}) ${o}`} cls="ghost" onClick={() => d({ type: "ANSWER", payload: { choice: k } })} />);
          break;
        }
        case "mercato":
        case "giramondo":
          controls =
            g.stage === "answering" ? (
              <>
                {ok}
                {ko}
              </>
            ) : (
              <>
                <Btn label="SCOPRI INDIZIO" onClick={() => d({ type: "REVEAL_CLUE" })} />
                {!room.roster.p1 && <Btn label={`PRENOTA ${s.config.players[0]}`} cls="p1" onClick={() => d({ type: "BUZZ", player: 0 })} />}
                {!room.roster.p2 && <Btn label={`PRENOTA ${s.config.players[1]}`} cls="p2" onClick={() => d({ type: "BUZZ", player: 1 })} />}
              </>
            );
          break;
        case "decina":
        case "dischetto":
        case "asta": {
          if (g.game === "asta" && g.stage === "bidding") {
            controls = (
              <>
                {Array.from({ length: g.max - (g.bid?.amount ?? 0) }, (_, k) => (g.bid?.amount ?? 0) + k + 1).map((n) => (
                  <Btn key={n} label={`${s.config.players[g.turn as 0 | 1]} dice ${n}`} cls="ghost" onClick={() => d({ type: "BID", player: g.turn, amount: n })} />
                ))}
                <Btn label="PASSO" cls="ko" onClick={() => d({ type: "PASS", player: g.turn })} />
              </>
            );
            break;
          }
          const said = new Set((g.said as { id: string }[]).map((x) => x.id));
          const pool = g.game === "dischetto" ? (g.item as DischettoItem).ranking.filter((r) => r.rank <= 10) : (g.item as SetItem).members;
          controls = (
            <>
              {g.stage === "feedback" ? <Btn label="CONTINUA" onClick={() => d({ type: "NEXT" })} /> : <Btn label="✗ ERRATA / NON VALE" cls="ko" onClick={() => d({ type: "VERDICT", payload: { id: null } })} />}
              {g.game === "asta" && <Btn label="FINE TEMPO / SI ARRENDE" cls="ghost" onClick={() => d({ type: "FINISH" })} />}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {pool.filter((m) => !said.has(m.id)).map((m) => (
                  <button key={m.id} className="chip" style={{ background: "transparent", color: "var(--ink)", fontFamily: "var(--term)", fontSize: 20 }} onClick={() => d({ type: "VERDICT", payload: { id: m.id } })}>
                    {m.name}
                  </button>
                ))}
              </div>
            </>
          );
          break;
        }
        case "formazione": {
          const it = g.item as FormazioneItem;
          if (g.stage === "choose") {
            controls = it.teams.map((t, k) => <Btn key={t.id} label={t.name} cls={k ? "p2" : "p1"} onClick={() => d({ type: "CHOOSE", value: k })} />);
            break;
          }
          const team = it.teams[g.teamOf[g.turn] as 0 | 1];
          controls = (
            <>
              {team.players.filter((p) => p.hidden).map((p) => (
                <button key={p.id} className={`btn ${sel.includes(p.id) ? "ok" : "ghost"}`} onClick={() => setSel((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))}>
                  {p.name}
                </button>
              ))}
              <Btn label={`CONFERMA ${sel.length}/5`} onClick={() => d({ type: "VERDICT", payload: { ids: sel } })} />
            </>
          );
          break;
        }
        case "prima_pagina": {
          const it = g.items[g.turn] as PrimaPaginaItem;
          controls = (
            <>
              {it.slots.map((sl, k) => (
                <button key={k} className={`btn ${slots[k] ? "ok" : "ghost"}`} onClick={() => setSlots((x) => x.map((v, i) => (i === k ? !v : v)))}>
                  {k + 1}. {sl.answer.display}
                </button>
              ))}
              <Btn label="CONFERMA" onClick={() => d({ type: "VERDICT", payload: { slots } })} />
            </>
          );
          break;
        }
        case "cassaforte":
          controls =
            g.stage === "choose" ? (
              [1, 2, 3].map((l) => <Btn key={l} label={["", "FACILE", "MEDIA", "DIFFICILE"][l]!} cls="ghost" onClick={() => d({ type: "CHOOSE", value: l })} />)
            ) : (
              <>
                {ok}
                {ko}
              </>
            );
          break;
        case "maglia":
          controls = (
            <>
              {ok}
              {ko}
            </>
          );
          break;
        case "frame": {
          const it = g.items[g.i] as FrameItem;
          controls = (
            <ScorePicker teams={it.teams} onSubmit={(score) => d({ type: "ANSWER", payload: { score, scorerCorrect: bonus } })}>
              {it.lastScorer && (
                <button className={`btn ${bonus ? "ok" : "ghost"}`} onClick={() => setBonus(!bonus)}>
                  BONUS MARCATORE {bonus ? "✓" : "✗"}
                </button>
              )}
            </ScorePicker>
          );
          break;
        }
        case "mappamondo":
          controls = <WorldMap onConfirm={(p) => d({ type: "ANSWER", payload: { lat: p.lat, lon: p.lon } })} />;
          break;
        case "filo_rosso":
          controls = <FiloInput ctx={ctx} onSubmit={(chain) => d({ type: "ANSWER", payload: { chain } })} />;
          break;
      }
  }
  return (
    <PhoneFrame title="REGIA" room={room}>
      {g && s.phase === "playing" && (
        <>
          <div className="px" style={{ fontSize: 12 }}>
            {g.turn !== null && g.turn !== undefined ? `Turno: ${s.config.players[g.turn]}` : ""} · fase: {g.stage}
          </div>
          <div className="panel" style={{ fontSize: 22 }}>
            <div className="px c-ok" style={{ fontSize: 11 }}>
              SOLUZIONE (solo per te)
            </div>
            {solutionOf(g).filter(Boolean).map((l, k) => (
              <div key={k}>{l}</div>
            ))}
          </div>
          {scriptOf(g) && <div className="copione" style={{ fontSize: 22 }}>{scriptOf(g)}</div>}
        </>
      )}
      <div className="col">{controls}</div>
    </PhoneFrame>
  );
}

function FiloInput({ ctx, onSubmit }: { ctx: EngineCtx; onSubmit: (c: string[]) => void }) {
  const [chain, setChain] = useState<string[]>([]);
  return (
    <>
      <div>{chain.join(" → ") || "Anelli intermedi:"}</div>
      <AnswerBox index={ctx.index} keyboard={false} submitLabel="+" onSubmit={(t) => setChain([...chain, t])} />
      <button className="btn" onClick={() => onSubmit(chain)}>
        CONFERMA CATENA
      </button>
    </>
  );
}

/* ------------------------------------------------------------ Pad (controller) */

function Scaled({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.5);
  useLayoutEffect(() => {
    const fit = () => ref.current && setK(ref.current.clientWidth / 1100);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div ref={ref} style={{ width: "100%", overflow: "hidden" }}>
      <div style={{ width: 1100, transform: `scale(${k})`, transformOrigin: "top left" }}>{children}</div>
    </div>
  );
}

function myTurn(g: GameStateAny, me: PlayerIdx): boolean {
  if (g.game === "cassaforte") return g.picks[g.k] === me && g.stage !== "reveal";
  if (g.game === "formazione" && g.stage === "choose") return g.starter === me;
  return g.turn === me && !["reveal", "final", "feedback", "done"].includes(g.stage);
}

export function PadRoom({ code, role, ctx }: { code: string; role: "p1" | "p2"; ctx: EngineCtx }) {
  const room = useRoom(role, code);
  const me: PlayerIdx = role === "p1" ? 0 : 1;
  const s: MatchState | null = room.state;
  const g = s?.game;
  useWakeLock(true);
  const turn = !!g && myTurn(g, me);
  useEffect(() => {
    if (turn) navigator.vibrate?.(80);
  }, [turn]);
  const color = me === 0 ? "var(--p1)" : "var(--p2)";
  if (!s || s.phase !== "playing" || !g) {
    return (
      <PhoneFrame title={`PULSANTIERA ${me + 1}`} room={room}>
        <div className="panel center" style={{ minHeight: 200, color }}>
          {s ? "Guarda lo schermo…" : "In attesa della partita…"}
        </div>
        {s && !room.roster.host && s.phase !== "match_over" && (
          <button className="btn ghost" onClick={() => room.dispatch(s.phase === "draw" ? { type: "START" } : s.phase === "intro" ? { type: "BEGIN_GAME" } : { type: "NEXT" })}>
            AVANTI ▶
          </button>
        )}
      </PhoneFrame>
    );
  }
  if (g.game === "mercato" || g.game === "giramondo") {
    const can = (g.stage === "clues" || g.stage === "ready") && !g.out[me];
    return (
      <PhoneFrame title={`PULSANTIERA ${me + 1}`} room={room}>
        {g.stage === "answering" && g.buzzer === me ? (
          <AnswerBox index={ctx.index} keyboard={false} onSubmit={(text) => room.dispatch({ type: "ANSWER", payload: { text } })} />
        ) : (
          <button
            className="buzz-btn"
            disabled={!can}
            style={{ height: "60vh", background: color, color: "var(--bg)", fontSize: 28 }}
            onPointerDown={(e) => {
              e.preventDefault();
              navigator.vibrate?.(40);
              room.buzz();
            }}
          >
            {g.out[me] ? "FUORI" : "PRENOTA!"}
          </button>
        )}
        {g.free && !g.out[me] && g.stage === "clues" && (
          <button className="btn ghost" onClick={() => room.dispatch({ type: "REVEAL_CLUE" })}>
            SCOPRI INDIZIO
          </button>
        )}
        {g.stage === "reveal" && !room.roster.host && (
          <button className="btn" onClick={() => room.dispatch({ type: "NEXT" })}>
            AVANTI ▶
          </button>
        )}
      </PhoneFrame>
    );
  }
  return (
    <PhoneFrame title={`PULSANTIERA ${me + 1}`} room={room}>
      {turn ? (
        <Scaled>
          <div className="col" style={{ gap: 18, padding: 20 }}>
            <GameView state={s} g={g} dispatch={room.dispatch} ctx={ctx} start={room.timerStart} />
          </div>
        </Scaled>
      ) : (
        <div className="panel center" style={{ minHeight: 160 }}>
          {g.stage === "reveal" || g.stage === "final" ? "Guarda lo schermo" : `Tocca a ${s.config.players[g.turn ?? 0]}`}
        </div>
      )}
      {(g.stage === "reveal" || g.stage === "final") && !room.roster.host && (
        <button className="btn" onClick={() => room.dispatch({ type: "NEXT" })}>
          AVANTI ▶
        </button>
      )}
      {g.game === "asta" && g.stage === "bidding" && g.turn === me && <div className="dim">Rilancia o passa.</div>}
    </PhoneFrame>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { usedIds, type EngineCtx, type GameStateAny, type MatchState } from "@trivela/engine";
import { GAME_IDS, type AnomaliaItem, type DischettoItem, type FormazioneItem, type GameId, type MagliaItem, type PlayerIdx, type SetItem, type TiroSeccoItem } from "@trivela/protocol";
import { audio } from "@trivela/audio";
import { joinUrl, useHostedRoom, useRoom, type ClientRole, type RoomClient } from "../runtime/room";
import { CODE_LENGTH, isRoomCode } from "../runtime/roomCore";
import { emptyCtx, forcedGamesFromUrl, leaguesForMatch, loadNamesIndex, newSeed, prepareFreshMatch, rememberSeen, savedLeagues } from "../runtime/packs";
import { MatchShell } from "./LocalMatch";
import { friendlyReason, LeaguesField, parseYear, PlayersFields, YearField } from "./Setup";
import { AnswerBox, ConfirmModal, Page, PlayCtx, StateTimer, TimerClockCtx, useTimeLeft, useWakeLock } from "../components/ui";
import { GameView } from "../games/GameView";
import { GAME_NAMES } from "../rules";
import { GAME_COLORS, GameIcon } from "../components/sprites";

const ROLE_LABEL: Record<ClientRole, string> = { host: "REGIA", p1: "GIOCATORE 1", p2: "GIOCATORE 2" };
const ROLE_COLOR: Record<ClientRole, string> = { host: "var(--accent)", p1: "var(--p1)", p2: "var(--p2)" };

function QrCard({ code, role, joined, label }: { code: string; role: ClientRole; joined: boolean; label: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(joinUrl(code, role), { margin: 1, width: 380, color: { dark: "#0b0b1a", light: "#f2f2ff" } }).then(setSrc);
  }, [code, role]);
  return (
    <div className={`qr-card ${joined ? "joined" : ""}`} style={{ color: ROLE_COLOR[role] }} data-role={role}>
      {src && <img src={src} alt={`QR ${label}`} />}
      <span className="px">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------ Screen: lobby + match */

type Mode = "host" | "pads";

export function RoomScreen({ ctx, onBack }: { ctx: EngineCtx; onBack: () => void }) {
  const room = useHostedRoom(ctx);
  const [mode, setMode] = useState<Mode>("pads");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [year, setYear] = useState("");
  const [leagues, setLeagues] = useState(savedLeagues);
  const [quickGame, setQuickGame] = useState<GameId | null>(null); // null: classic five-game match
  const [formatKind, setFormatKind] = useState<"classic" | "quick">("classic");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [matchCtx, setMatchCtx] = useState(ctx);
  useWakeLock(true);
  const { roster } = room;
  // a phone that joins as Regia switches the lobby to "con conduttore"
  useEffect(() => {
    if (roster.host) setMode("host");
  }, [roster.host]);

  if (room.state) {
    return (
      <MatchShell
        state={room.state}
        dispatch={room.dispatch}
        ctx={matchCtx}
        start={room.timerStart}
        clock={room.timer}
        mode={{ readonly: roster.host || roster.p1 || roster.p2, flow: !roster.host, pad: false }}
        onExit={(s) => {
          rememberSeen(usedIds(s));
          room.start(null);
        }}
        onAbort={() => room.start(null)}
      />
    );
  }

  const ready = mode === "host" ? roster.host : roster.p1 && roster.p2;
  const start = async () => {
    audio.play("select");
    const yearFrom = parseYear(year);
    if (yearFrom === undefined) {
      setError("Anno non valido.");
      return;
    }
    setLoading(true);
    setError("");
    const r = await prepareFreshMatch({
      judging: room.judging(),
      players: [p1.trim() || "Giocatore 1", p2.trim() || "Giocatore 2"],
      yearFrom,
      leagues: leaguesForMatch(leagues),
      seed: newSeed(),
      forcedGames: formatKind === "quick" && quickGame ? [quickGame] : forcedGamesFromUrl(),
      ...(formatKind === "quick" && quickGame ? { rounds: 3 } : {}),
    });
    setLoading(false);
    if (!r.ok) {
      setError(friendlyReason(r.reason, yearFrom));
      return;
    }
    setMatchCtx(r.ctx);
    room.start(r.state, r.ctx);
  };

  return (
    <Page title="SCHERMO + TELEFONI" onBack={onBack} wide>
      <div className="row wrap">
        <span className="label">STANZA</span>
        <span className="code">{room.code}</span>
        <span className="grow" />
        <span className={`status-dot ${room.connected ? "on" : ""}`}>{room.connected ? "IN LINEA" : "MI COLLEGO…"}</span>
      </div>
      <div className="mode-pick">
        <button className={mode === "pads" ? "on" : ""} onClick={() => setMode("pads")}>
          <b>SENZA CONDUTTORE · 2 TELEFONI</b>
          Ogni giocatore usa il proprio telefono per prenotarsi e rispondere. L'app corregge da sola.
        </button>
        <button className={mode === "host" ? "on" : ""} onClick={() => setMode("host")}>
          <b>CON CONDUTTORE · 1 TELEFONO</b>
          Il conduttore vede soluzioni e copione sul telefono e convalida le risposte date a voce.
        </button>
      </div>
      <div className="panel col">
        <span className="label">INQUADRA IL QR CON LA FOTOCAMERA DEL TELEFONO</span>
        <div className={mode === "host" ? "grid3" : "grid2"} style={mode === "host" ? { gridTemplateColumns: "minmax(0, 260px)", justifyContent: "center" } : { maxWidth: 520, margin: "0 auto", width: "100%" }}>
          {mode === "host" ? (
            <QrCard code={room.code} role="host" joined={roster.host} label="REGIA (CONDUTTORE)" />
          ) : (
            <>
              <QrCard code={room.code} role="p1" joined={roster.p1} label={p1.trim() || "GIOCATORE 1"} />
              <QrCard code={room.code} role="p2" joined={roster.p2} label={p2.trim() || "GIOCATORE 2"} />
            </>
          )}
        </div>
        <span className="note">
          Senza fotocamera: sul telefono apri questo stesso sito, tocca «ENTRA CON CODICE» e scrivi <b className="c-accent">{room.code}</b>. Non serve la stessa Wi-Fi: basta una connessione a internet su ogni dispositivo.
        </span>
      </div>
      <div className="field">
        <label>FORMATO DELLA SFIDA</label>
        <div className="seg">
          <button className={`btn ${formatKind === "classic" ? "" : "ghost"}`} onClick={() => setFormatKind("classic")}>
            PARTITA COMPLETA
          </button>
          <button className={`btn ${formatKind === "quick" ? "" : "ghost"}`} onClick={() => setFormatKind("quick")}>
            SFIDA RAPIDA
          </button>
        </div>
        <span className="note">{formatKind === "classic" ? "5 giochi sorteggiati su 9." : "Un solo gioco a scelta, 3 round a testa."}</span>
        {formatKind === "quick" && (
          <div className="game-pick">
            {GAME_IDS.map((g) => (
              <button key={g} className={quickGame === g ? "on" : ""} style={{ "--game": GAME_COLORS[g], background: quickGame === g ? "#2a2a10" : undefined } as React.CSSProperties} onClick={() => setQuickGame(g)}>
                <GameIcon game={g} size={40} />
                <span>
                  <b>{GAME_NAMES[g]}</b>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <PlayersFields p1={p1} p2={p2} setP1={setP1} setP2={setP2} />
      <YearField year={year} setYear={setYear} />
      <LeaguesField value={leagues} onChange={setLeagues} />
      {error && <div className="err">{error}</div>}
      <button className="btn big" disabled={loading || !ready || (formatKind === "quick" && !quickGame)} onClick={() => void start()}>
        {loading ? "CARICO I GIOCHI…" : formatKind === "quick" && !quickGame ? "SCEGLI IL GIOCO" : ready ? "INIZIA LA PARTITA ▶" : mode === "host" ? "IN ATTESA DELLA REGIA…" : `IN ATTESA DEI TELEFONI (${Number(roster.p1) + Number(roster.p2)}/2)…`}
      </button>
    </Page>
  );
}

export function RoomJoin({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState("");
  const ok = isRoomCode(code);
  return (
    <Page title="ENTRA CON CODICE" onBack={onBack}>
      <div className="field">
        <label>CODICE DELLA STANZA (È SULLO SCHERMO PRINCIPALE)</label>
        <input className="input code" style={{ textAlign: "center", fontSize: 30 }} value={code} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, CODE_LENGTH))} placeholder={"·".repeat(CODE_LENGTH)} />
      </div>
      <span className="label">QUESTO TELEFONO È…</span>
      {(["p1", "p2", "host"] as const).map((r) => (
        <button key={r} className="btn big" style={{ background: ROLE_COLOR[r] }} disabled={!ok} onClick={() => (location.hash = `#/join/${code}?r=${r}`)}>
          {r === "host" ? "LA REGIA (CONDUTTORE)" : `LA PULSANTIERA DEL ${ROLE_LABEL[r]}`}
        </button>
      ))}
    </Page>
  );
}

/* ------------------------------------------------------------ Shared phone frame */

/**
 * Full-height phone layout: a compact header, an area that scrolls, and the buttons pinned to the bottom edge, so the
 * main actions are always in the thumb's reach and never need a scroll.
 */
function PhoneFrame({ role, room, children, top, actions, onEnd }: { role: ClientRole; room: RoomClient; children: ReactNode; top?: ReactNode; actions?: ReactNode; onEnd?: () => void }) {
  const s = room.state;
  const g = s?.order[s.gameIdx];
  const [asking, setAsking] = useState(false);
  return (
    <div className="page phone-shell">
      <div className="page-bg" aria-hidden />
      <div className="phone-head">
        <div className="phone-top">
          <span style={{ color: ROLE_COLOR[role] }}>{role === "host" ? "REGIA" : s ? s.config.players[role === "p1" ? 0 : 1] : ROLE_LABEL[role]}</span>
          <span className="dim">· {room.code}</span>
          <span className="grow" />
          <span className={`status-dot ${room.live ? "on" : ""}`}>{room.live ? "COLLEGATO" : room.connected ? "CERCO LO SCHERMO…" : "MI COLLEGO…"}</span>
          {onEnd && s && (
            <button className="phone-end" aria-label="Termina partita" title="Termina partita" onClick={() => setAsking(true)}>
              ✕
            </button>
          )}
        </div>
        {s && (
          <div className="phone-score">
            <span className="c-p1">
              {s.config.players[0]} {s.scores[0]}
            </span>
            <span className="mid">{g ? GAME_NAMES[g] : "FINE"}</span>
            <span className="c-p2 r">
              {s.scores[1]} {s.config.players[1]}
            </span>
          </div>
        )}
        {top}
      </div>
      <div className="phone-scroll">
        {!room.live && !s ? (
          <div className="panel waiting">
            <span className="blink">CERCO LA STANZA {room.code}…</span>
            <span className="note">Controlla che lo schermo principale sia acceso sulla pagina della stanza e che il codice sia giusto.</span>
            <button className="btn ghost" onClick={() => (location.hash = "")}>
              CAMBIA CODICE
            </button>
          </div>
        ) : (
          children
        )}
      </div>
      {actions && <div className="phone-actions">{actions}</div>}
      {asking && (
        <ConfirmModal
          fixed
          title="SEI SICURO DI VOLER TERMINARE LA SFIDA?"
          text="La partita si chiude per tutti e si torna alla sala d'attesa."
          confirm="SÌ, TERMINA"
          onConfirm={() => {
            setAsking(false);
            onEnd?.();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Regia */

function solutionOf(g: GameStateAny): string[] {
  switch (g.game) {
    case "tiro_secco":
    case "anomalia": {
      const it = g.items[g.i] as TiroSeccoItem | AnomaliaItem;
      return [it.question, `Risposta: ${"ABCD"[it.correct]}) ${it.options[it.correct]}`];
    }
    case "mercato":
    case "giramondo": {
      const it = g.items[g.i] as { answer: { display: string }; clues: string[] };
      return [`Risposta: ${it.answer.display}`, ...it.clues.map((c, k) => `${k + 1}. ${c}`)];
    }
    case "decina":
    case "asta":
      return [(g.item as SetItem).title, (g.item as SetItem).description, `${(g.item as SetItem).members.length} risposte valide: tocca il nome detto dal giocatore.`];
    case "dischetto": {
      const it = g.item as DischettoItem;
      return [it.title, it.hint, ...it.ranking.filter((r) => r.rank <= 10).map((r) => `${r.rank}. ${r.name} (${r.label ?? r.value})`)];
    }
    case "formazione": {
      const it = g.item as FormazioneItem;
      return [`${it.title} · ${it.competition}`, ...it.teams.map((t) => `${t.name}: ${t.players.filter((p) => p.hidden).map((p) => p.name).join(", ")}`)];
    }
    case "maglia": {
      const it = g.items[g.i] as MagliaItem;
      return [it.question, `Risposta: numero ${it.answer.display}`];
    }
  }
  return [];
}

function scriptOf(g: GameStateAny): string {
  if (g.script) return g.script;
  const it = g.item ?? g.items?.[g.i];
  return it?.script ?? "";
}

/** Clock of the host: pause/play and +10 / -10 seconds; the Screen follows at once. */
function HostTimerPad({ room }: { room: RoomClient }) {
  const s = room.state!;
  const t = s.timer;
  const live = !!t && t.kind !== "feedback" && t.kind !== "ready";
  const ms = room.timer.ms ?? t?.ms ?? 0;
  const left = useTimeLeft(ms, room.timerStart, live ? room.timer.pausedLeft : null);
  if (!live || s.phase !== "playing") return null;
  const paused = room.timer.pausedLeft !== null;
  const tap = (f: () => void) => () => (audio.play("blip"), navigator.vibrate?.(20), f());
  return (
    <div className={`timerpad ${paused ? "paused" : ""}`}>
      <div className="timerpad-top">
        <span className="label">TEMPO · {paused ? "IN PAUSA" : "IN CORSO"}</span>
        <span className="led">{Math.ceil(left / 1000)}</span>
      </div>
      <div className="timerpad-keys">
        <button className={`btn ${paused ? "ok" : ""}`} onClick={tap(() => room.timerOp(paused ? "resume" : "pause"))}>
          {paused ? "PLAY ▶" : "II PAUSA"}
        </button>
        <button className="btn ghost" onClick={tap(() => room.timerOp("add", 10_000))}>
          +10 s
        </button>
        <button className="btn ghost" onClick={tap(() => room.timerOp("add", -10_000))}>
          −10 s
        </button>
      </div>
    </div>
  );
}

export function HostRoom({ code }: { code: string }) {
  const room = useRoom("host", code);
  useWakeLock(true);
  const s = room.state;
  const d = room.dispatch;
  const [sel, setSel] = useState<string[]>([]);
  const g = s?.game;
  useEffect(() => {
    setSel([]);
  }, [g?.i, g?.round, g?.k, g?.turn, g?.stage]);
  if (!s) {
    return (
      <PhoneFrame role="host" room={room}>
        <div className="panel waiting">
          <span>SEI LA REGIA</span>
          <span className="note">Quando lo schermo principale avvia la partita, qui compaiono soluzioni, copione e pulsanti per convalidare le risposte.</span>
        </div>
      </PhoneFrame>
    );
  }
  const Btn = ({ label, onClick, cls = "" }: { label: string; onClick: () => void; cls?: string }) => (
    <button className={`btn big ${cls}`} onClick={() => (audio.play("blip"), onClick())}>
      {label}
    </button>
  );
  const okKo = (
    <div className="grid2">
      <Btn label="✓ ESATTA" cls="ok" onClick={() => d({ type: "VERDICT", payload: { correct: true } })} />
      <Btn label="✗ SBAGLIATA" cls="ko" onClick={() => d({ type: "VERDICT", payload: { correct: false } })} />
    </div>
  );
  let controls: ReactNode = null;
  let picks: ReactNode = null; // long lists of names: they scroll, the buttons below them stay put
  if (s.phase === "draw") controls = <Btn label="INIZIA ▶" onClick={() => d({ type: "START" })} />;
  else if (s.phase === "intro") controls = <Btn label="VIA AL GIOCO ▶" onClick={() => d({ type: "BEGIN_GAME" })} />;
  else if (s.phase === "game_over") controls = <Btn label="PROSSIMO GIOCO ▶" onClick={() => d({ type: "NEXT" })} />;
  else if (s.phase === "match_over") controls = <div className="panel waiting c-accent">PARTITA FINITA</div>;
  else if (g) {
    if (["reveal", "final"].includes(g.stage)) controls = <Btn label="AVANTI ▶" onClick={() => d({ type: "NEXT" })} />;
    else
      switch (g.game) {
        case "tiro_secco":
        case "anomalia": {
          const it = g.items[g.i] as TiroSeccoItem;
          controls = it.options.map((o, k) => <Btn key={k} label={`${"ABCD"[k]}) ${o}`} cls={k === it.correct ? "ok" : "ghost"} onClick={() => d({ type: "ANSWER", payload: { choice: k } })} />);
          break;
        }
        case "mercato":
        case "giramondo":
          controls =
            g.stage === "answering" ? (
              okKo
            ) : (
              <>
                <Btn label="SCOPRI INDIZIO" onClick={() => d({ type: "REVEAL_CLUE" })} />
                <div className="grid2">
                  {([0, 1] as const).map((p) => (
                    <Btn key={p} label={g.out[p] ? `${s.config.players[p]} FUORI` : `PRENOTA ${s.config.players[p]}`} cls={p === 0 ? "p1" : "p2"} onClick={() => d({ type: "BUZZ", player: p })} />
                  ))}
                </div>
              </>
            );
          break;
        case "decina":
        case "dischetto":
        case "asta": {
          if (g.game === "asta" && g.stage === "bidding") {
            const from = (g.bid?.amount ?? 0) + 1;
            controls = (
              <>
                <span className="label">{s.config.players[g.turn as PlayerIdx]} DICE…</span>
                <div className="grid3" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                  {Array.from({ length: Math.max(0, g.max - from + 1) }, (_, k) => from + k).map((n) => (
                    <button key={n} className="btn ghost" onClick={() => d({ type: "BID", player: g.turn, amount: n })}>
                      {n}
                    </button>
                  ))}
                </div>
                <Btn label="PASSA" cls="ko" onClick={() => d({ type: "PASS", player: g.turn })} />
              </>
            );
            break;
          }
          const said = new Set((g.said as { id: string }[]).map((x) => x.id));
          const pool = g.game === "dischetto" ? (g.item as DischettoItem).ranking.filter((r) => r.rank <= 10) : (g.item as SetItem).members;
          controls =
            g.stage === "feedback" ? (
              <Btn label="CONTINUA ▶" onClick={() => d({ type: "NEXT" })} />
            ) : (
              <div className="grid2">
                <Btn label="✗ ERRATA" cls="ko" onClick={() => d({ type: "VERDICT", payload: { id: null } })} />
                {g.game === "asta" ? <Btn label="SI ARRENDE" cls="ghost" onClick={() => d({ type: "FINISH" })} /> : <span />}
              </div>
            );
          if (g.stage !== "feedback")
            picks = (
              <div className="pick-grid">
                {pool
                  .filter((m) => !said.has(m.id))
                  .map((m) => (
                    <button key={m.id} onClick={() => d({ type: "VERDICT", payload: { id: m.id } })}>
                      {m.name}
                    </button>
                  ))}
              </div>
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
          picks = (
            <>
              <span className="label">TOCCA I TITOLARI INDOVINATI ({team.name})</span>
              <div className="pick-grid">
                {team.players
                  .filter((p) => p.hidden)
                  .map((p) => (
                    <button key={p.id} className={sel.includes(p.id) ? "on" : ""} onClick={() => setSel((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))}>
                      {sel.includes(p.id) ? "✓ " : ""}
                      {p.name}
                    </button>
                  ))}
              </div>
            </>
          );
          controls = <Btn label={`CONFERMA ${sel.length}/5`} onClick={() => d({ type: "VERDICT", payload: { ids: sel } })} />;
          break;
        }
        case "maglia":
          controls = okKo;
          break;
      }
  }
  return (
    <PhoneFrame role="host" room={room} top={<HostTimerPad room={room} />} actions={controls} onEnd={() => room.endMatch()}>
      {g && s.phase === "playing" && (
        <>
          {g.turn !== null && g.turn !== undefined && (
            <div className={`px ${g.turn === 0 ? "c-p1" : "c-p2"}`} style={{ fontSize: 12 }}>
              TOCCA A {s.config.players[g.turn as PlayerIdx]}
            </div>
          )}
          <div className="solution-box">
            <span className="label">SOLUZIONE (SOLO PER TE)</span>
            {solutionOf(g)
              .filter(Boolean)
              .map((l, k) => (
                <div key={k}>{l}</div>
              ))}
          </div>
          {scriptOf(g) && <div className="copione">{scriptOf(g)}</div>}
        </>
      )}
      {picks}
    </PhoneFrame>
  );
}

/* ------------------------------------------------------------ Controller */

/** Draws the game controls on a narrow virtual canvas scaled to the phone width. */
/** Virtual width of the controller canvas: narrow enough that text and buttons stay big on a phone. */
const PAD_WIDTH = 520;

function PadCanvas({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current!;
    const i = inner.current!;
    const fit = () => {
      const k = o.clientWidth / PAD_WIDTH;
      i.style.transform = `scale(${k})`;
      o.style.height = `${i.offsetHeight * k}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="pad-scale">
      <div ref={inner} className="pad-canvas">
        {children}
      </div>
    </div>
  );
}

function myTurn(g: GameStateAny, me: PlayerIdx): boolean {
  if (g.game === "formazione" && g.stage === "choose") return g.starter === me;
  return g.turn === me && !["reveal", "final", "feedback", "done"].includes(g.stage);
}

export function PadRoom({ code, role }: { code: string; role: "p1" | "p2" }) {
  const room = useRoom(role, code);
  // the people index (names only, no questions) feeds the spelling helper on this phone too
  const [index, setIndex] = useState(emptyCtx.index);
  useEffect(() => {
    let live = true;
    void loadNamesIndex().then((i) => live && setIndex(i));
    return () => {
      live = false;
    };
  }, []);
  const padCtx = useMemo(() => ({ index }), [index]);
  const me: PlayerIdx = role === "p1" ? 0 : 1;
  const s: MatchState | null = room.state;
  const g = s?.game;
  useWakeLock(true);
  const turn = !!g && s?.phase === "playing" && myTurn(g, me);
  useEffect(() => {
    if (turn) navigator.vibrate?.(80);
  }, [turn]);
  const color = me === 0 ? "var(--p1)" : "var(--p2)";
  const flow = !room.roster.host;
  const next = s && flow && s.phase !== "match_over" && (
    <button className="btn big next" onClick={() => room.dispatch(s.phase === "draw" ? { type: "START" } : s.phase === "intro" ? { type: "BEGIN_GAME" } : { type: "NEXT" })}>
      {s.phase === "draw" ? "SI PARTE ▶" : s.phase === "intro" ? "VIA! ▶" : "AVANTI ▶"}
    </button>
  );
  if (!s || s.phase !== "playing" || !g) {
    return (
      <PhoneFrame role={role} room={room} actions={next}>
        <div className="panel waiting" style={{ color }}>
          {!s ? (
            <>
              <span>SEI IL {ROLE_LABEL[role]}</span>
              <span className="note">In attesa che lo schermo principale avvii la partita…</span>
            </>
          ) : s.phase === "match_over" ? (
            "PARTITA FINITA!"
          ) : (
            "GUARDA LO SCHERMO"
          )}
        </div>
      </PhoneFrame>
    );
  }
  if (g.game === "mercato" || g.game === "giramondo") {
    const can = (g.stage === "clues" || g.stage === "ready") && !g.out[me];
    return (
      <PhoneFrame
        role={role}
        room={room}
        actions={
          <>
            {g.free && !g.out[me] && g.stage === "clues" && (
              <button className="btn big ghost" onClick={() => room.dispatch({ type: "REVEAL_CLUE" })}>
                SCOPRI UN ALTRO INDIZIO
              </button>
            )}
            {g.stage === "reveal" && next}
          </>
        }
      >
        {g.stage === "answering" && g.buzzer === me ? (
          s.config.judging === "host" ? (
            <div className="panel waiting" style={{ color }}>
              RISPONDI A VOCE!
            </div>
          ) : (
            <AnswerBox index={index} placeholder="Chi è?" onSubmit={(text) => room.dispatch({ type: "ANSWER", payload: { text } })} />
          )
        ) : g.stage === "reveal" ? (
          <div className="panel waiting">GUARDA LO SCHERMO</div>
        ) : (
          <button
            className="big-buzz"
            disabled={!can}
            style={{ background: color }}
            onPointerDown={(e) => {
              e.preventDefault();
              navigator.vibrate?.(40);
              room.buzz();
            }}
          >
            {g.out[me] ? "FUORI" : "PRENOTA!"}
          </button>
        )}
      </PhoneFrame>
    );
  }
  const closed = g.stage === "reveal" || g.stage === "final";
  if (turn && s.config.judging !== "host" && (g.game === "tiro_secco" || g.game === "anomalia")) {
    // four options: the question scrolls, the answers stay under the thumb
    const it = g.items[g.i] as TiroSeccoItem;
    return (
      <PhoneFrame
        role={role}
        room={room}
        actions={it.options.map((o, k) => (
          <button key={k} className="btn big ghost" onClick={() => (navigator.vibrate?.(30), room.dispatch({ type: "ANSWER", payload: { choice: k } }))}>
            {"ABCD"[k]}) {o}
          </button>
        ))}
      >
        <TimerClockCtx.Provider value={room.timer}>
          <div className="pad-question">
            <div className="px dim" style={{ fontSize: 11 }}>
              DOMANDA {g.i + 1}/{g.items.length}
            </div>
            <StateTimer state={s} start={room.timerStart} />
            <div className="q-card">
              <div className="q">{it.question}</div>
            </div>
          </div>
        </TimerClockCtx.Provider>
      </PhoneFrame>
    );
  }
  return (
    <PhoneFrame role={role} room={room} actions={closed ? next : undefined}>
      {turn && s.config.judging === "host" ? (
        <div className="panel waiting" style={{ color }}>
          TOCCA A TE: RISPONDI A VOCE!
        </div>
      ) : turn ? (
        <PlayCtx.Provider value={{ readonly: false, flow, pad: true }}>
          <TimerClockCtx.Provider value={room.timer}>
            <PadCanvas>
              <GameView state={s} g={g} dispatch={room.dispatch} ctx={padCtx} start={room.timerStart} />
            </PadCanvas>
          </TimerClockCtx.Provider>
        </PlayCtx.Provider>
      ) : (
        <div className="panel waiting">{closed || g.stage === "feedback" ? "GUARDA LO SCHERMO" : `TOCCA A ${s.config.players[(g.turn ?? g.starter ?? 0) as PlayerIdx]}`}</div>
      )}
    </PhoneFrame>
  );
}

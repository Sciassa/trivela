import { useState } from "react";
import { LEAGUES } from "@trivela/protocol";
import { GAME_NAMES } from "../rules";
import type { Format } from "./GamePicker";
import type { EngineCtx, MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";
import { ALL_LEAGUES, forcedGamesFromUrl, leaguesForMatch, newSeed, prepareFreshMatch, saveLeagues, savedLeagues } from "../runtime/packs";
import { Page } from "../components/ui";

export interface SetupResult {
  state: MatchState;
  tableMode: boolean;
  ctx: EngineCtx;
}

/** A game that cannot be drawn with the current filters is not a bug: say what to loosen. */
export function friendlyReason(reason: string, yearFrom: number | null): string {
  if (/insufficienti/i.test(reason)) return `${reason} Con questi filtri non ci sono abbastanza domande: ${yearFrom ? "prova con un anno precedente o " : "prova "}ad attivare altri campionati.`;
  return reason;
}

/** Parse the "from year" field; undefined when it is not a plausible year. */
export function parseYear(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const y = Number(text);
  return Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : undefined;
}

export function PlayersFields({ p1, p2, setP1, setP2, locked }: { p1: string; p2: string; setP1: (v: string) => void; setP2: (v: string) => void; locked?: boolean }) {
  return (
    <div className="grid2">
      <div className="field">
        <label className="c-p1">GIOCATORE 1</label>
        <input className="input" value={p1} maxLength={14} disabled={locked} placeholder="Nome" onChange={(e) => setP1(e.target.value)} style={{ borderColor: "var(--p1)" }} />
      </div>
      <div className="field">
        <label className="c-p2">GIOCATORE 2</label>
        <input className="input" value={p2} maxLength={14} disabled={locked} placeholder="Nome" onChange={(e) => setP2(e.target.value)} style={{ borderColor: "var(--p2)" }} />
      </div>
    </div>
  );
}

export function YearField({ year, setYear, locked }: { year: string; setYear: (v: string) => void; locked?: boolean }) {
  return (
    <div className="field">
      <label>SOLO DOMANDE DALL'ANNO… (VUOTO = TUTTE LE STAGIONI)</label>
      <input className="input" inputMode="numeric" value={year} disabled={locked} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="es. 2018" />
      <span className="note">I dati partono dalla stagione 2012/13. Elenchi e classifiche (Decina, Dischetto, Asta) usano sempre tutte le stagioni.</span>
    </div>
  );
}

/** Which championships the questions may come from; national teams and big tournaments are always in. */
export function LeaguesField({ value, onChange, locked }: { value: string[]; onChange: (v: string[]) => void; locked?: boolean }) {
  const toggle = (id: string) => {
    if (locked) return;
    const next = value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
    if (!next.length) return; // at least one league stays on
    saveLeagues(next);
    onChange(next);
  };
  return (
    <div className="field">
      <label>CAMPIONATI INCLUSI NELLE DOMANDE</label>
      <div className="league-pick">
        {LEAGUES.map((l) => (
          <button key={l.id} type="button" className={value.includes(l.id) ? "on" : ""} aria-pressed={value.includes(l.id)} disabled={locked} onClick={() => toggle(l.id)}>
            {value.includes(l.id) ? "✓ " : ""}
            {l.name}
          </button>
        ))}
        {!locked && value.length < ALL_LEAGUES.length && (
          <button type="button" className="all" onClick={() => (saveLeagues(ALL_LEAGUES), onChange(ALL_LEAGUES))}>
            TUTTI
          </button>
        )}
      </div>
      <span className="note">Nazionali, Mondiali, Europei, Champions, Europa e Conference League sono sempre inclusi. Con pochi campionati alcuni giochi hanno meno domande e possono non uscire.</span>
    </div>
  );
}

export function Setup({
  onStart,
  onBack,
  presetPlayers,
  yearFrom: presetYear,
  leagues: presetLeagues,
  excludeIds,
  format,
}: {
  onStart: (r: SetupResult) => void;
  onBack: () => void;
  presetPlayers?: [string, string];
  yearFrom?: number | null;
  leagues?: string[] | null;
  excludeIds?: string[];
  /** Sfida Rapida or Allenamento on one chosen game; absent: the classic five-game match. */
  format?: Format;
}) {
  const [p1, setP1] = useState(presetPlayers?.[0] ?? "");
  const [p2, setP2] = useState(presetPlayers?.[1] ?? "");
  const [year, setYear] = useState(presetYear ? String(presetYear) : "");
  const [leagues, setLeagues] = useState<string[]>(() => (presetLeagues === undefined ? savedLeagues() : presetLeagues ?? ALL_LEAGUES));
  const [tableMode, setTableMode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const start = async () => {
    audio.play("select");
    const yearFrom = parseYear(year);
    if (yearFrom === undefined) {
      setError("Anno non valido.");
      return;
    }
    setLoading(true);
    const training = format?.kind === "training";
    const r = await prepareFreshMatch({
      judging: "auto",
      players: [p1.trim() || (training ? "Giocatore" : "Giocatore 1"), training ? "—" : p2.trim() || "Giocatore 2"],
      yearFrom,
      leagues: leaguesForMatch(leagues),
      seed: newSeed(),
      excludeIds,
      forcedGames: format ? [format.game] : forcedGamesFromUrl(),
      ...(format?.kind === "quick" ? { rounds: 3 } : {}),
      ...(training ? { solo: true } : {}),
    });
    setLoading(false);
    if (!r.ok) {
      setError(friendlyReason(r.reason, yearFrom));
      return;
    }
    onStart({ state: r.state, tableMode, ctx: r.ctx });
  };

  return (
    <Page title={format ? `${format.kind === "quick" ? "SFIDA RAPIDA" : "ALLENAMENTO"} · ${GAME_NAMES[format.game]}` : "NUOVA SFIDA · UN SOLO SCHERMO"} onBack={onBack} wide>
      <div className="form-cols">
      <div className="form-col">
      {format?.kind === "training" ? (
        <div className="field">
          <label className="c-p1">IL TUO NOME</label>
          <input className="input" value={p1} maxLength={14} placeholder="Nome (facoltativo)" onChange={(e) => setP1(e.target.value)} style={{ borderColor: "var(--p1)" }} />
        </div>
      ) : (
        <PlayersFields p1={p1} p2={p2} setP1={setP1} setP2={setP2} locked={!!presetPlayers} />
      )}
      <YearField year={year} setYear={setYear} locked={presetYear !== undefined} />
      </div>
      <div className="form-col">
      <LeaguesField value={leagues} onChange={setLeagues} locked={presetLeagues !== undefined} />
      {format?.kind !== "training" && (
      <div className="field">
        <label>DOVE STA LO SCHERMO?</label>
        <div className="seg">
          <button className={`btn ${tableMode ? "ghost" : ""}`} onClick={() => setTableMode(false)}>
            DI FRONTE
          </button>
          <button className={`btn ${tableMode ? "" : "ghost"}`} onClick={() => setTableMode(true)}>
            SUL TAVOLO
          </button>
        </div>
        <span className="note">{tableMode ? "Sul tavolo tra i due giocatori: i pulsanti di prenotazione sono girati verso i lati." : "TV, PC o tablet davanti a entrambi i giocatori."}</span>
      </div>
      )}
      </div>
      </div>
      <div className="panel note">
        {!format
          ? "5 giochi sorteggiati su 9 · al massimo 2 domande a testa per gioco · vince chi fa più punti."
          : format.kind === "quick"
            ? `${GAME_NAMES[format.game]}: solo questo gioco, 3 round a testa · vince chi fa più punti.`
            : `${GAME_NAMES[format.game]}: da solo, senza turni né avversari. Nessuna classifica: serve per allenarsi.`}
      </div>
      {error && <div className="err">{error}</div>}
      <button className="btn big" onClick={() => void start()} disabled={loading}>
        {loading ? "CARICO I GIOCHI…" : "GIOCA ▶"}
      </button>
    </Page>
  );
}

import { useState } from "react";
import type { EngineCtx, MatchState } from "@trivela/engine";
import { audio } from "@trivela/audio";
import { forcedGamesFromUrl, newSeed, prepareFreshMatch } from "../runtime/packs";
import { Page } from "../components/ui";

export interface SetupResult {
  state: MatchState;
  tableMode: boolean;
  ctx: EngineCtx;
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

export function Setup({
  onStart,
  onBack,
  presetPlayers,
  yearFrom: presetYear,
  excludeIds,
}: {
  onStart: (r: SetupResult) => void;
  onBack: () => void;
  presetPlayers?: [string, string];
  yearFrom?: number | null;
  excludeIds?: string[];
}) {
  const [p1, setP1] = useState(presetPlayers?.[0] ?? "");
  const [p2, setP2] = useState(presetPlayers?.[1] ?? "");
  const [year, setYear] = useState(presetYear ? String(presetYear) : "");
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
    const r = await prepareFreshMatch({
      judging: "auto",
      players: [p1.trim() || "Giocatore 1", p2.trim() || "Giocatore 2"],
      yearFrom,
      seed: newSeed(),
      excludeIds,
      forcedGames: forcedGamesFromUrl(),
    });
    setLoading(false);
    if (!r.ok) {
      setError(yearFrom ? `${r.reason} Prova con un anno precedente.` : r.reason);
      return;
    }
    onStart({ state: r.state, tableMode, ctx: r.ctx });
  };

  return (
    <Page title="NUOVA SFIDA · UN SOLO SCHERMO" onBack={onBack}>
      <PlayersFields p1={p1} p2={p2} setP1={setP1} setP2={setP2} locked={!!presetPlayers} />
      <YearField year={year} setYear={setYear} locked={presetYear !== undefined} />
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
      <div className="panel note">5 giochi sorteggiati su 10 · al massimo 2 domande a testa per gioco · vince chi fa più punti.</div>
      {error && <div className="err">{error}</div>}
      <button className="btn big" onClick={() => void start()} disabled={loading}>
        {loading ? "CARICO I GIOCHI…" : "GIOCA ▶"}
      </button>
    </Page>
  );
}

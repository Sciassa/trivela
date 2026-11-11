import { useEffect, useMemo, useState } from "react";
import { createMatch, parseTopic, type EngineCtx, type MatchState } from "@trivela/engine";
import type { Packs } from "@trivela/protocol";
import { audio } from "@trivela/audio";
import { seenIds } from "../runtime/packs";

export interface SetupResult {
  state: MatchState;
  tableMode: boolean;
}

export function TopicField({ label, value, onChange, ctx, color }: { label: string; value: string; onChange: (v: string) => void; ctx: EngineCtx; color: string }) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), 300);
    return () => window.clearTimeout(t);
  }, [value]);
  const res = useMemo(() => (debounced.trim().length >= 3 ? parseTopic(debounced, ctx.index) : null), [debounced, ctx]);
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Scrivi quello che vuoi: una squadra, un torneo, un'epoca…" style={{ borderColor: color }} />
      <span style={{ fontSize: 20, minHeight: 24 }} className={res?.status === "unknown" ? "c-ko" : "dim"}>
        {res ? (res.status === "unknown" ? "Non riconosco un argomento calcistico: riscrivilo." : `Argomento: ${res.summary}`) : " "}
      </span>
    </div>
  );
}

export function Setup({
  packs,
  ctx,
  onStart,
  onBack,
  presetPlayers,
  yearFrom: presetYear,
  excludeIds,
  judging = "auto",
}: {
  packs: Packs;
  ctx: EngineCtx;
  onStart: (r: SetupResult) => void;
  onBack: () => void;
  presetPlayers?: [string, string];
  yearFrom?: number | null;
  excludeIds?: string[];
  judging?: "auto" | "host";
}) {
  const [p1, setP1] = useState(presetPlayers?.[0] ?? "");
  const [p2, setP2] = useState(presetPlayers?.[1] ?? "");
  const [year, setYear] = useState(presetYear ? String(presetYear) : "");
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [tableMode, setTableMode] = useState(false);
  const [error, setError] = useState("");
  const yearLocked = presetYear !== undefined;

  const start = () => {
    audio.play("select");
    const yearFrom = year.trim() ? Number(year) : null;
    if (yearFrom !== null && (!Number.isFinite(yearFrom) || yearFrom < 1850 || yearFrom > 2100)) {
      setError("Anno non valido.");
      return;
    }
    // Debug aid: ?games=a,b,c,d forces the four drawn games (used by visual checks).
    const forced = new URLSearchParams(location.search).get("games")?.split(",").filter(Boolean) as never;
    const base = {
      ...(forced ? { forcedGames: forced } : {}),
      judging,
      players: [p1.trim() || "Giocatore 1", p2.trim() || "Giocatore 2"] as [string, string],
      yearFrom,
      topics: [t1, t2] as [string, string],
      seed: (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0,
    };
    let r = createMatch({ ...base, excludeIds: [...seenIds(), ...(excludeIds ?? [])] }, packs, ctx);
    if (!r.ok && !r.reason.startsWith("Argomento")) r = createMatch({ ...base, excludeIds }, packs, ctx);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    onStart({ state: r.state, tableMode });
  };

  return (
    <div className="phone-ui" style={{ maxWidth: 900 }}>
      <div className="row">
        <button className="btn ghost" onClick={onBack}>
          ◀
        </button>
        <span className="px c-accent" style={{ fontSize: 20 }}>
          NUOVA SFIDA
        </span>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="field grow">
          <label>GIOCATORE 1</label>
          <input className="input" value={p1} onChange={(e) => setP1(e.target.value)} style={{ borderColor: "var(--p1)" }} />
        </div>
        <div className="field grow">
          <label>GIOCATORE 2</label>
          <input className="input" value={p2} onChange={(e) => setP2(e.target.value)} style={{ borderColor: "var(--p2)" }} />
        </div>
      </div>
      <div className="field">
        <label>DOMANDE SUL CALCIO A PARTIRE DALL'ANNO (vuoto = tutte le epoche)</label>
        <input className="input" inputMode="numeric" value={year} disabled={yearLocked} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="es. 2005" />
        <span className="dim" style={{ fontSize: 18 }}>
          Elenchi e classifiche (Decina, Dischetto, Asta) e gli argomenti a piacere usano sempre tutte le epoche.
        </span>
      </div>
      <TopicField label={`ARGOMENTO A PIACERE DI ${p1 || "GIOCATORE 1"}`} value={t1} onChange={setT1} ctx={ctx} color="var(--p1)" />
      <TopicField label={`ARGOMENTO A PIACERE DI ${p2 || "GIOCATORE 2"}`} value={t2} onChange={setT2} ctx={ctx} color="var(--p2)" />
      {judging === "auto" && (
        <div className="row">
          <span className="dim">Schermo singolo:</span>
          <button className={`btn ${!tableMode ? "" : "ghost"}`} onClick={() => setTableMode(false)}>
            LEGGIO
          </button>
          <button className={`btn ${tableMode ? "" : "ghost"}`} onClick={() => setTableMode(true)}>
            TAVOLO
          </button>
        </div>
      )}
      {error && <div className="c-ko">{error}</div>}
      <button className="btn" onClick={start} disabled={!t1.trim() || !t2.trim()}>
        GIOCA ▶
      </button>
    </div>
  );
}

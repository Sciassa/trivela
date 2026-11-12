import { useEffect, useState } from "react";
import { createTournament, recordResult, standings, usedIds, type EngineCtx, type MatchState, type TournamentState } from "@trivela/engine";
import type { Packs } from "@trivela/protocol";
import { LocalMatch } from "./LocalMatch";
import { Setup } from "./Setup";

const KEY = "trivela.tournament";

function load(): TournamentState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TournamentState) : null;
  } catch {
    return null;
  }
}
function save(t: TournamentState | null) {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function Tournament({ packs, ctx, onBack }: { packs: Packs; ctx: EngineCtx; onBack: () => void }) {
  const [t, setT] = useState<TournamentState | null>(load);
  const [names, setNames] = useState("");
  const [year, setYear] = useState("");
  const [playing, setPlaying] = useState<{ matchId: string; state: MatchState; tableMode: boolean; ctx: EngineCtx } | null>(null);
  const [setupFor, setSetupFor] = useState<string | null>(null);
  useEffect(() => save(t), [t]);

  if (playing && t) {
    return (
      <LocalMatch
        initial={playing.state}
        ctx={playing.ctx}
        tableMode={playing.tableMode}
        onExit={(s) => {
          const m = t.matches.find((x) => x.id === playing.matchId)!;
          const cassa = s.gamePoints[s.order.length - 1] ?? [0, 0];
          const flip = s.config.players[0] !== t.players[m.a];
          const sa = flip ? s.scores[1] : s.scores[0];
          const sb = flip ? s.scores[0] : s.scores[1];
          setT(recordResult(t, m.id, sa, sb, { cassaA: flip ? cassa[1] : cassa[0], cassaB: flip ? cassa[0] : cassa[1], usedIds: usedIds(s) }));
          setPlaying(null);
        }}
      />
    );
  }
  if (setupFor && t) {
    const m = t.matches.find((x) => x.id === setupFor)!;
    return (
      <Setup
        packs={packs}
        ctx={ctx}
        presetPlayers={[t.players[m.a]!, t.players[m.b]!]}
        yearFrom={t.yearFrom}
        excludeIds={t.usedIds}
        onBack={() => setSetupFor(null)}
        onStart={(r) => {
          setPlaying({ matchId: m.id, state: r.state, tableMode: r.tableMode, ctx: r.ctx });
          setSetupFor(null);
        }}
      />
    );
  }

  if (!t) {
    const list = names.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    return (
      <div className="phone-ui" style={{ maxWidth: 900 }}>
        <div className="row">
          <button className="btn ghost" onClick={onBack}>
            ◀
          </button>
          <span className="px c-accent">NUOVO TORNEO</span>
        </div>
        <div className="field">
          <label>GIOCATORI (da 4 a 12, uno per riga o separati da virgola)</label>
          <textarea className="input" rows={6} value={names} onChange={(e) => setNames(e.target.value)} />
        </div>
        <div className="field">
          <label>DOMANDE A PARTIRE DALL'ANNO (vuoto = tutte)</label>
          <input className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        </div>
        <div className="dim">Fase 1: Classifica Generale (punti sommati, anche negativi). Fase 2: semifinali 1ª-4ª e 2ª-3ª, poi finale.</div>
        <button className="btn" disabled={list.length < 4 || list.length > 12} onClick={() => setT(createTournament(list, { yearFrom: year ? Number(year) : null }))}>
          CREA TORNEO
        </button>
      </div>
    );
  }

  const table = standings(t);
  const next = t.matches.find((m) => m.scoreA === null);
  const label = { league: "Classifica Generale", semi: "Semifinali", final: "Finale", done: "Torneo concluso" }[t.phase];
  const finalMatch = t.matches.find((m) => m.stage === "final" && m.scoreA !== null);
  return (
    <div className="phone-ui" style={{ maxWidth: 1000 }}>
      <div className="row">
        <button className="btn ghost" onClick={onBack}>
          ◀
        </button>
        <span className="px c-accent">TORNEO · {label}</span>
      </div>
      <table className="panel" style={{ width: "100%", borderCollapse: "collapse", fontSize: 26 }}>
        <thead>
          <tr className="px" style={{ fontSize: 11, textAlign: "left" }}>
            <th>#</th>
            <th>NOME</th>
            <th>G</th>
            <th>V</th>
            <th>PUNTI</th>
          </tr>
        </thead>
        <tbody>
          {table.map((r, i) => (
            <tr key={r.player} style={{ color: i < 4 ? "var(--accent)" : undefined }}>
              <td>{i + 1}</td>
              <td>{r.name}</td>
              <td>{r.played}</td>
              <td>{r.wins}</td>
              <td>{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {next && (
        <div className="panel col">
          <div className="px" style={{ fontSize: 14 }}>
            PROSSIMA SFIDA ({next.stage === "league" ? `turno ${next.round}` : next.stage === "semi" ? "semifinale" : "finale"})
          </div>
          <div style={{ fontSize: 34 }}>
            <span className="c-p1">{t.players[next.a]}</span> vs <span className="c-p2">{t.players[next.b]}</span>
          </div>
          <button className="btn" onClick={() => setSetupFor(next.id)}>
            GIOCA ▶
          </button>
        </div>
      )}
      {t.phase === "done" && finalMatch && (
        <div className="title-logo" style={{ fontSize: 40, textAlign: "center" }}>
          CAMPIONE: {t.players[(finalMatch.scoreA ?? 0) >= (finalMatch.scoreB ?? 0) ? finalMatch.a : finalMatch.b]}
        </div>
      )}
      <div className="row">
        <button
          className="btn ghost"
          onClick={() => {
            const blob = new Blob([JSON.stringify(t, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "trivela-torneo.json";
            a.click();
          }}
        >
          ESPORTA
        </button>
        <label className="btn ghost">
          IMPORTA
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setT(JSON.parse(await f.text()) as TournamentState);
            }}
          />
        </label>
        <span className="grow" />
        <button className="btn ko" onClick={() => confirm("Cancellare il torneo?") && setT(null)}>
          CANCELLA
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { createTournament, recordResult, standings, usedIds, winnerOfMatch, type EngineCtx, type MatchState, type TournamentState } from "@trivela/engine";
import { LocalMatch } from "./LocalMatch";
import { LeaguesField, Setup } from "./Setup";
import { ALL_LEAGUES, leaguesForMatch, savedLeagues } from "../runtime/packs";
import { Page } from "../components/ui";

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

export function Tournament({ onBack }: { onBack: () => void }) {
  const [t, setT] = useState<TournamentState | null>(load);
  const [names, setNames] = useState("");
  const [year, setYear] = useState("");
  const [leagues, setLeagues] = useState(savedLeagues);
  const [playing, setPlaying] = useState<{ matchId: string; state: MatchState; tableMode: boolean; ctx: EngineCtx } | null>(null);
  const [setupFor, setSetupFor] = useState<string | null>(null);
  useEffect(() => save(t), [t]);

  if (playing && t) {
    return (
      <LocalMatch
        initial={playing.state}
        ctx={playing.ctx}
        tableMode={playing.tableMode}
        onAbort={() => setPlaying(null)}
        onExit={(s) => {
          const m = t.matches.find((x) => x.id === playing.matchId)!;
          const flip = s.config.players[0] !== t.players[m.a];
          setT(recordResult(t, m.id, flip ? s.scores[1] : s.scores[0], flip ? s.scores[0] : s.scores[1], { usedIds: usedIds(s) }));
          setPlaying(null);
        }}
      />
    );
  }
  if (setupFor && t) {
    const m = t.matches.find((x) => x.id === setupFor)!;
    return (
      <Setup
        presetPlayers={[t.players[m.a]!, t.players[m.b]!]}
        yearFrom={t.yearFrom}
        leagues={t.leagues ?? null}
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
      <Page title="NUOVO TORNEO" onBack={onBack}>
        <div className="field">
          <label>GIOCATORI (DA 4 A 12, UNO PER RIGA O SEPARATI DA VIRGOLA)</label>
          <textarea className="input" rows={6} value={names} onChange={(e) => setNames(e.target.value)} />
        </div>
        <div className="field">
          <label>SOLO DOMANDE DALL'ANNO… (VUOTO = TUTTE)</label>
          <input className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="es. 2018" />
        </div>
        <LeaguesField value={leagues} onChange={setLeagues} />
        <div className="note">Fase 1: Classifica Generale (si sommano i punti di tutte le sfide). Fase 2: semifinali 1ª-4ª e 2ª-3ª, poi finale.</div>
        <button className="btn big" disabled={list.length < 4 || list.length > 12} onClick={() => setT(createTournament(list, { yearFrom: year ? Number(year) : null, leagues: leaguesForMatch(leagues) }))}>
          CREA IL TORNEO ({list.length} GIOCATORI)
        </button>
      </Page>
    );
  }

  const table = standings(t);
  const next = t.matches.find((m) => m.scoreA === null);
  const label = { league: "CLASSIFICA GENERALE", semi: "SEMIFINALI", final: "FINALE", done: "CONCLUSO" }[t.phase];
  const finalMatch = t.matches.find((m) => m.stage === "final" && m.scoreA !== null);
  return (
    <Page title={`TORNEO · ${label}`} onBack={onBack} wide>
      {t.phase === "done" && finalMatch && (
        <div className="panel center">
          <span className="code">🏆 {t.players[winnerOfMatch(finalMatch)]}</span>
        </div>
      )}
      {next && (
        <div className="panel col" style={{ gap: 10 }}>
          <span className="label">PROSSIMA SFIDA · {next.stage === "league" ? `TURNO ${next.round}` : next.stage === "semi" ? "SEMIFINALE" : "FINALE"}</span>
          <div style={{ fontSize: 34 }}>
            <span className="c-p1">{t.players[next.a]}</span> <span className="dim">vs</span> <span className="c-p2">{t.players[next.b]}</span>
          </div>
          <button className="btn big" onClick={() => setSetupFor(next.id)}>
            GIOCA ▶
          </button>
        </div>
      )}
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>NOME</th>
              <th>GIOCATE</th>
              <th>VINTE</th>
              <th>PUNTI</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r, i) => (
              <tr key={r.player} className={i < 4 ? "top" : ""}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td>{r.played}</td>
                <td>{r.wins}</td>
                <td>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel col" style={{ gap: 4 }}>
        <span className="label">RISULTATI</span>
        {t.matches
          .filter((m) => m.scoreA !== null)
          .map((m) => (
            <div key={m.id}>
              <span className="dim">{m.stage === "league" ? `T${m.round}` : m.stage === "semi" ? "SF" : "F"}</span> {t.players[m.a]} {m.scoreA} - {m.scoreB} {t.players[m.b]}
            </div>
          ))}
      </div>
      <div className="row wrap">
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
        <label className="btn ghost" style={{ display: "inline-flex", alignItems: "center" }}>
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
    </Page>
  );
}

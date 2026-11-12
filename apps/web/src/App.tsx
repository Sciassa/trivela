import { useEffect, useState } from "react";
import type { MatchState, EngineCtx } from "@trivela/engine";
import type { Packs } from "@trivela/protocol";
import { audio } from "@trivela/audio";
import { emptyCtx, loadCore } from "./runtime/packs";
import { Stage } from "./components/ui";
import { Setup } from "./screens/Setup";
import { LocalMatch } from "./screens/LocalMatch";
import { Tournament } from "./screens/Tournament";
import { RoomScreen, RoomJoin, HostRoom, PadRoom } from "./screens/Rooms";
import { GAME_NAMES } from "./rules";

type Route =
  | { name: "start" }
  | { name: "menu" }
  | { name: "setup" }
  | { name: "local"; state: MatchState; tableMode: boolean; ctx: EngineCtx }
  | { name: "tournament" }
  | { name: "room-screen" }
  | { name: "join" }
  | { name: "credits" }
  | { name: "audio" };

function hashRoute(): { role: "host" | "p1" | "p2"; code: string } | null {
  const m = location.hash.match(/^#\/join\/([A-Z]{4})\?r=(host|p1|p2)/);
  return m ? { code: m[1]!, role: m[2] as "host" | "p1" | "p2" } : null;
}

export function App() {
  const [data, setData] = useState<{ packs: Packs; ctx: EngineCtx } | null>(null);
  const [route, setRoute] = useState<Route>({ name: "start" });
  const [remote, setRemote] = useState(hashRoute);
  useEffect(() => {
    if (!hashRoute()) void loadCore().then(setData);
    const h = () => setRemote(hashRoute());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  if (remote) {
    // phones never download question packs nor the entity index
    return remote.role === "host" ? <HostRoom code={remote.code} ctx={emptyCtx} /> : <PadRoom code={remote.code} role={remote.role} ctx={emptyCtx} />;
  }
  if (!data) {
    return (
      <Stage>
        <div className="home">
          <div className="px blink">CARICAMENTO…</div>
        </div>
      </Stage>
    );
  }
  const go = (r: Route) => {
    audio.play("select");
    setRoute(r);
  };
  const { packs, ctx } = data;
  switch (route.name) {
    case "start":
      return (
        <Stage>
          <div
            className="home"
            onPointerDown={async () => {
              await audio.unlock();
              audio.startMusic();
              audio.play("coin");
              setRoute({ name: "menu" });
            }}
          >
            <div className="col center">
              <div className="title-logo">TRIVELA</div>
              <div className="px dim" style={{ fontSize: 16 }}>
                IL QUIZ PER MANIACI DEL CALCIO
              </div>
              <div className="px blink c-accent" style={{ fontSize: 22, marginTop: 60 }}>
                PREMI START
              </div>
              <div className="dim" style={{ marginTop: 40 }}>
                {Object.values(packs.manifest.counts).reduce((a, b) => a + (b ?? 0), 0)} domande verificate · dati al {packs.manifest.snapshot || "—"}
              </div>
            </div>
          </div>
        </Stage>
      );
    case "menu":
      return (
        <Stage>
          <div className="home">
            <div className="col center">
              <div className="title-logo" style={{ fontSize: 72 }}>
                TRIVELA
              </div>
              <div className="menu">
                <button className="btn" onClick={() => go({ name: "setup" })}>
                  SFIDA · 1 SCHERMO
                </button>
                <button className="btn p1" onClick={() => go({ name: "room-screen" })}>
                  SFIDA · PIÙ SCHERMI (REGIA / PULSANTIERE)
                </button>
                <button className="btn ghost" onClick={() => go({ name: "join" })}>
                  ENTRA IN UNA STANZA (TELEFONO)
                </button>
                <button className="btn p2" onClick={() => go({ name: "tournament" })}>
                  TORNEO TRA AMICI
                </button>
                <div className="row">
                  <button className="btn ghost grow" onClick={() => go({ name: "audio" })}>
                    AUDIO
                  </button>
                  <button className="btn ghost grow" onClick={() => go({ name: "credits" })}>
                    FONTI
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Stage>
      );
    case "setup":
      return <Setup packs={packs} ctx={ctx} onBack={() => go({ name: "menu" })} onStart={(r) => setRoute({ name: "local", state: r.state, tableMode: r.tableMode, ctx: r.ctx })} />;
    case "local":
      return <LocalMatch initial={route.state} ctx={route.ctx} tableMode={route.tableMode} onExit={() => go({ name: "menu" })} />;
    case "tournament":
      return <Tournament packs={packs} ctx={ctx} onBack={() => go({ name: "menu" })} />;
    case "room-screen":
      return <RoomScreen packs={packs} ctx={ctx} onBack={() => go({ name: "menu" })} />;
    case "join":
      return <RoomJoin />;
    case "audio":
      return <AudioSettings onBack={() => go({ name: "menu" })} />;
    case "credits":
      return (
        <div className="phone-ui" style={{ maxWidth: 1000 }}>
          <button className="btn ghost" onClick={() => go({ name: "menu" })}>
            ◀
          </button>
          <div className="px c-accent">FONTI E VERIFICA</div>
          <p>
            Ogni fatto usato nelle domande è confermato da almeno due famiglie di fonti indipendenti. Se le fonti non concordano, il dato non entra nel gioco.
          </p>
          {packs.manifest.sources.map((s) => (
            <div key={s.family} className="panel">
              <div className="px" style={{ fontSize: 13 }}>
                {s.label}
              </div>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.url}
              </a>
              <div className="dim">Licenza: {s.licence}</div>
            </div>
          ))}
          <div className="panel">
            {Object.entries(packs.manifest.counts).map(([g, n]) => (
              <div key={g}>
                {GAME_NAMES[g as keyof typeof GAME_NAMES]}: {n}
              </div>
            ))}
          </div>
        </div>
      );
  }
}

function AudioSettings({ onBack }: { onBack: () => void }) {
  const [p, setP] = useState(audio.prefs);
  const upd = (x: Partial<typeof p>) => {
    audio.setPrefs(x);
    setP({ ...audio.prefs });
    audio.play("blip");
  };
  return (
    <div className="phone-ui">
      <button className="btn ghost" onClick={onBack}>
        ◀
      </button>
      <div className="field">
        <label>MUSICA</label>
        <input type="range" min={0} max={1} step={0.1} value={p.music} onChange={(e) => upd({ music: Number(e.target.value) })} />
      </div>
      <div className="field">
        <label>EFFETTI</label>
        <input type="range" min={0} max={1} step={0.1} value={p.sfx} onChange={(e) => upd({ sfx: Number(e.target.value) })} />
      </div>
      <button className="btn" onClick={() => upd({ muted: !p.muted })}>
        {p.muted ? "AUDIO OFF" : "AUDIO ON"}
      </button>
      <div className="row">
        {(["goal", "sad", "post", "boo", "buzz", "fanfare"] as const).map((s) => (
          <button key={s} className="btn ghost" onClick={() => audio.play(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

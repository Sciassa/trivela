import { useEffect, useState } from "react";
import type { MatchState, EngineCtx } from "@trivela/engine";
import type { Packs } from "@trivela/protocol";
import { audio } from "@trivela/audio";
import { loadCore } from "./runtime/packs";
import { isRoomCode } from "./runtime/roomCore";
import { Page, Stage } from "./components/ui";
import { Sprite } from "./components/sprites";
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
  const m = location.hash.match(/^#\/join\/([A-Z]+)\?r=(host|p1|p2)/);
  return m && isRoomCode(m[1]!) ? { code: m[1]!, role: m[2] as "host" | "p1" | "p2" } : null;
}

export function App() {
  const [data, setData] = useState<{ packs: Packs; ctx: EngineCtx } | null>(null);
  const [route, setRoute] = useState<Route>({ name: "start" });
  const [remote, setRemote] = useState(hashRoute);
  useEffect(() => {
    const h = () => setRemote(hashRoute());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  // phones joining a room never download questions nor the people index
  useEffect(() => {
    if (!remote && !data) void loadCore().then(setData);
  }, [remote, data]);

  if (remote) return remote.role === "host" ? <HostRoom key={remote.code} code={remote.code} /> : <PadRoom key={remote.code + remote.role} code={remote.code} role={remote.role} />;
  if (!data) {
    return (
      <Stage>
        <div className="home">
          <Sprite name="ball" size={120} className="blink" />
          <div className="px blink">CARICAMENTO…</div>
        </div>
      </Stage>
    );
  }
  const go = (r: Route) => {
    audio.play("select");
    setRoute(r);
  };
  const menu = () => go({ name: "menu" });
  const { packs, ctx } = data;
  const total = Object.values(packs.manifest.counts).reduce((a, b) => a + (b ?? 0), 0);
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
            <div className="title-logo">TRIVELA</div>
            <div className="tagline">IL QUIZ PER MANIACI DEL CALCIO</div>
            <div className="start-cta blink">PREMI START</div>
            <div className="stat">
              {total.toLocaleString("it-IT")} domande verificate · dati aggiornati al {packs.manifest.snapshot || "—"}
            </div>
            <div className="ballrun">
              <Sprite name="ball" size={72} />
            </div>
          </div>
        </Stage>
      );
    case "menu":
      return (
        <Stage>
          <div className="home">
            <div className="title-logo" style={{ fontSize: 76, animation: "none" }}>
              TRIVELA
            </div>
            <div className="menu">
              <button className="btn" onClick={() => go({ name: "setup" })}>
                <Sprite name="screen" size={84} />
                <span>
                  UN SOLO SCHERMO
                  <small>Tutti e due sullo stesso dispositivo</small>
                </span>
              </button>
              <button className="btn p1" onClick={() => go({ name: "room-screen" })}>
                <Sprite name="phone" size={84} />
                <span>
                  SCHERMO + TELEFONI
                  <small>Con conduttore o con 2 pulsantiere</small>
                </span>
              </button>
              <button className="btn p2" onClick={() => go({ name: "tournament" })}>
                <Sprite name="trophy" size={84} />
                <span>
                  TORNEO TRA AMICI
                  <small>Da 4 a 12: classifica, semifinali, finale</small>
                </span>
              </button>
              <button className="btn ghost" onClick={() => go({ name: "join" })}>
                <Sprite name="maglia" size={84} className="c-accent" />
                <span>
                  ENTRA CON CODICE
                  <small>Questo telefono fa da Regia o pulsantiera</small>
                </span>
              </button>
            </div>
            <div className="menu-foot">
              <button className="btn ghost small" onClick={() => go({ name: "audio" })}>
                ♪ AUDIO
              </button>
              <button className="btn ghost small" onClick={() => go({ name: "credits" })}>
                FONTI DEI DATI
              </button>
              <span className="stat">{total.toLocaleString("it-IT")} domande · 10 giochi</span>
            </div>
          </div>
        </Stage>
      );
    case "setup":
      return <Setup onBack={menu} onStart={(r) => setRoute({ name: "local", state: r.state, tableMode: r.tableMode, ctx: r.ctx })} />;
    case "local":
      return <LocalMatch initial={route.state} ctx={route.ctx} tableMode={route.tableMode} onExit={menu} />;
    case "tournament":
      return <Tournament onBack={menu} />;
    case "room-screen":
      return <RoomScreen ctx={ctx} onBack={menu} />;
    case "join":
      return <RoomJoin onBack={menu} />;
    case "audio":
      return <AudioSettings onBack={menu} />;
    case "credits":
      return (
        <Page title="FONTI E VERIFICA" onBack={menu} wide>
          <div className="panel">
            Ogni domanda è calcolata sui dati, non scritta a mano: partite, formazioni, marcatori, trasferimenti e numeri di maglia vengono da un'unica fonte pubblica. I record incompleti o incoerenti (per esempio partite in cui i gol registrati non tornano con il risultato) vengono scartati, e classifiche ed elenchi dichiarano sempre competizione e stagioni coperte.
          </div>
          {packs.manifest.sources.map((s) => (
            <div key={s.family} className="panel col" style={{ gap: 4 }}>
              <span className="label c-accent">{s.label}</span>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.url}
              </a>
              <span className="note">Licenza: {s.licence}</span>
            </div>
          ))}
          <div className="panel grid2">
            {Object.entries(packs.manifest.counts).map(([g, n]) => (
              <div key={g}>
                {GAME_NAMES[g as keyof typeof GAME_NAMES]}: <span className="c-accent">{n}</span>
              </div>
            ))}
          </div>
          <div className="note">Dati aggiornati al {packs.manifest.snapshot} · pacchetto {packs.manifest.version}</div>
        </Page>
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
    <Page title="AUDIO" onBack={onBack}>
      <div className="field">
        <label>MUSICA</label>
        <input type="range" min={0} max={1} step={0.1} value={p.music} onChange={(e) => upd({ music: Number(e.target.value) })} />
      </div>
      <div className="field">
        <label>EFFETTI</label>
        <input type="range" min={0} max={1} step={0.1} value={p.sfx} onChange={(e) => upd({ sfx: Number(e.target.value) })} />
      </div>
      <button className="btn big" onClick={() => upd({ muted: !p.muted })}>
        {p.muted ? "AUDIO SPENTO" : "AUDIO ACCESO"}
      </button>
      <span className="label">PROVA GLI EFFETTI</span>
      <div className="grid3">
        {(["goal", "sad", "post", "boo", "buzz", "fanfare"] as const).map((s) => (
          <button key={s} className="btn ghost" onClick={() => audio.play(s)}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>
    </Page>
  );
}

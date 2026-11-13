import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { MatchState, EngineCtx } from "@trivela/engine";
import type { Packs } from "@trivela/protocol";
import { audio } from "@trivela/audio";
import { loadCore } from "./runtime/packs";
import { isRoomCode } from "./runtime/roomCore";
import { Fit, Page, setSpeller, spellerOn, Stage } from "./components/ui";
import { Sprite } from "./components/sprites";
import { Logo } from "./components/scenery";
import { Setup } from "./screens/Setup";
import { LocalMatch } from "./screens/LocalMatch";
import { Tournament } from "./screens/Tournament";
import { GamePicker, type Format } from "./screens/GamePicker";
import { RoomScreen, RoomJoin, HostRoom, PadRoom } from "./screens/Rooms";
import { GAME_NAMES } from "./rules";

type Route =
  | { name: "start" }
  | { name: "menu" }
  | { name: "setup"; format?: Format }
  | { name: "pick"; purpose: Format["kind"] }
  | { name: "local"; state: MatchState; tableMode: boolean; ctx: EngineCtx; format?: Format }
  | { name: "tournament" }
  | { name: "room-screen" }
  | { name: "join" }
  | { name: "credits" }
  | { name: "audio" };

function hashRoute(): { role: "host" | "p1" | "p2"; code: string } | null {
  const m = location.hash.match(/^#\/join\/([A-Z]+)\?r=(host|p1|p2)/);
  return m && isRoomCode(m[1]!) ? { code: m[1]!, role: m[2] as "host" | "p1" | "p2" } : null;
}

function MenuCard({ icon, title, text, color, onClick, primary, badge, i }: { icon: ReactNode; title: string; text: string; color: string; onClick: () => void; primary?: boolean; badge?: string; i: number }) {
  return (
    <button className={`menu-card ${primary ? "primary" : ""}`} style={{ "--c": color, "--i": i } as CSSProperties} onClick={onClick}>
      {badge && <span className="badge">{badge}</span>}
      <span className="ico">{icon}</span>
      <span>
        <b>{title}</b>
        <small>{text}</small>
      </span>
    </button>
  );
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
      <Stage variant="sunset">
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
        <Stage variant="sunset">
          <div
            className="home"
            onPointerDown={async () => {
              await audio.unlock();
              audio.startMusic();
              audio.play("coin");
              setRoute({ name: "menu" });
            }}
          >
            <Logo size={150} />
            <div className="tagline">IL QUIZ PER MANIACI DEL CALCIO</div>
            <div className="start-cta blink">PREMI START</div>
            <div className="stat">
              {total.toLocaleString("it-IT")} domande verificate · dati aggiornati al {packs.manifest.snapshot || "—"}
            </div>
          </div>
        </Stage>
      );
    case "menu":
      return (
        <Stage variant="sunset">
          <div className="home">
            <Fit center>
              <div className="home-menu">
                <div className="menu-hero">
                  <Logo size={84} />
                  <div className="tagline">IL QUIZ PER MANIACI DEL CALCIO</div>
                </div>
                <div className="menu-cols">
                  <section className="menu-group">
                    <h2>GIOCA SU QUESTO SCHERMO</h2>
                    <MenuCard primary badge="CONSIGLIATO" color="#ffd23f" icon={<Sprite name="screen" size={72} />} title="PARTITA COMPLETA" text="5 giochi sorteggiati su 9, due giocatori" onClick={() => go({ name: "setup" })} i={0} />
                    <MenuCard color="#5ee06a" icon={<Sprite name="clock" size={64} />} title="SFIDA RAPIDA" text="Un solo gioco a scelta, 3 round a testa" onClick={() => go({ name: "pick", purpose: "quick" })} i={1} />
                    <MenuCard color="#7fd8ff" icon={<Sprite name="face" size={64} />} title="ALLENAMENTO" text="Da solo, un gioco, nessun avversario" onClick={() => go({ name: "pick", purpose: "training" })} i={2} />
                  </section>
                  <section className="menu-group">
                    <h2>CON GLI AMICI</h2>
                    <MenuCard color="#4adfff" icon={<Sprite name="phone" size={64} />} title="SCHERMO + TELEFONI" text="Con conduttore o 2 pulsantiere" onClick={() => go({ name: "room-screen" })} i={3} />
                    <MenuCard color="#ff7ad9" icon={<Sprite name="trophy" size={64} />} title="TORNEO TRA AMICI" text="Da 4 a 12 giocatori: classifica e finale" onClick={() => go({ name: "tournament" })} i={4} />
                    <MenuCard color="#c9a8ff" icon={<Sprite name="maglia" size={64} />} title="ENTRA CON CODICE" text="Questo telefono è Regia o pulsantiera" onClick={() => go({ name: "join" })} i={5} />
                  </section>
                </div>
                <div className="menu-foot">
                  <button className="btn ghost small" onClick={() => go({ name: "audio" })}>
                    ♪ OPZIONI
                  </button>
                  <button className="btn ghost small" onClick={() => go({ name: "credits" })}>
                    FONTI DEI DATI
                  </button>
                  <span className="stat">{total.toLocaleString("it-IT")} domande · 9 giochi</span>
                </div>
              </div>
            </Fit>
          </div>
        </Stage>
      );
    case "setup":
      return (
        <Setup
          key={route.format ? `${route.format.kind}-${route.format.game}` : "classic"}
          format={route.format}
          onBack={() => (route.format ? go({ name: "pick", purpose: route.format.kind }) : menu())}
          onStart={(r) => setRoute({ name: "local", state: r.state, tableMode: r.tableMode, ctx: r.ctx, format: route.format })}
        />
      );
    case "pick":
      return <GamePicker purpose={route.purpose} onBack={menu} onPick={(game) => setRoute({ name: "setup", format: { kind: route.purpose, game } })} />;
    case "local":
      return <LocalMatch initial={route.state} ctx={route.ctx} tableMode={route.tableMode} onExit={menu} onAbort={menu} onAgain={() => setRoute({ name: "setup", format: route.format })} />;
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
  const [speller, setSp] = useState(spellerOn);
  const upd = (x: Partial<typeof p>) => {
    audio.setPrefs(x);
    setP({ ...audio.prefs });
    audio.play("blip");
  };
  return (
    <Page title="OPZIONI" onBack={onBack}>
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
      <div className="field">
        <label>CORRETTORE ORTOGRAFICO DEI NOMI</label>
        <button
          className={`btn ${speller ? "" : "ghost"}`}
          onClick={() => {
            setSpeller(!speller);
            setSp(!speller);
          }}
        >
          {speller ? "ACCESO" : "SPENTO"}
        </button>
        <span className="note">Corregge solo l'ortografia di un nome già scritto quasi per intero: non completa e non suggerisce risposte.</span>
      </div>
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

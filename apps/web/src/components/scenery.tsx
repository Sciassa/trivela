import type { CSSProperties } from "react";
import { Sprite } from "./sprites";

/** Pixel scenery drawn from character maps: clouds, sparkles, moon and the logo. */

const COLORS: Record<string, string> = { w: "#ffffff", L: "#bfe0ff", B: "#82b6ea", k: "#1b0a3f", c: "#e9edf6", d: "#c9d3e6", y: "#ffe27a" };

function Grid({ rows, size, className = "", style }: { rows: string[]; size: number; className?: string; style?: CSSProperties }) {
  const w = Math.max(...rows.map((r) => r.length));
  const rects: JSX.Element[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let n = 1;
      while (x + n < row.length && row[x + n] === ch) n++;
      if (ch !== ".") rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={n} height={1.02} fill={COLORS[ch]} />);
      x += n;
    }
  });
  return (
    <svg className={`sprite ${className}`} style={style} width={(size * w) / rows.length} height={size} viewBox={`0 0 ${w} ${rows.length}`} shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
}

const pad = (s: string, n = 26) => s.padEnd(n, ".");
const CLOUD_A = [
  pad("........wwwww"),
  pad("......wwwwwwwwww..wwww"),
  pad("....wwwwwwwwwwwwwwwwwwww"),
  pad("..wwwwwwwwwwwwwwwwwwwwwwww"),
  pad(".wwwwwwwwwwwwwwwwwwwwwwwww"),
  pad(".LLLLLLLLLLLLLLLLLLLLLLLL"),
  pad("...BBBBBBBBBBBBBBBBBBB"),
];
const CLOUD_B = [pad("....wwww", 18), pad("..wwwwwwww.ww", 18), pad(".wwwwwwwwwwwww", 18), pad("wwwwwwwwwwwwwwww", 18), pad(".LLLLLLLLLLLLLL", 18), pad("...BBBBBBBBB", 18)];
const SPARKLE = ["...w...", "...w...", "...w...", "wwwwwww", "...w...", "...w...", "...w..."];

export function PixelCloud({ variant = "a", size = 84, className = "", style }: { variant?: "a" | "b"; size?: number; className?: string; style?: CSSProperties }) {
  return <Grid rows={variant === "a" ? CLOUD_A : CLOUD_B} size={size} className={className} style={style} />;
}

export function Sparkle({ size = 28, style }: { size?: number; style?: CSSProperties }) {
  return <Grid rows={SPARKLE} size={size} className="sparkle" style={style} />;
}

/** A pixel moon: a disc on a 17×17 grid with a shaded edge and a few craters. */
function moonRows(): string[] {
  const n = 17;
  const c = 8;
  const craters = new Set(["5,4", "6,4", "5,5", "10,9", "11,9", "10,10", "11,10", "7,12", "8,12", "4,9"]);
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => {
      const d = Math.hypot(x - c, y - c);
      if (d > 8.2) return ".";
      if (d > 7.1) return "k"; // outline
      if (craters.has(`${x},${y}`)) return "d";
      return x - c + (y - c) > 4 ? "d" : "c"; // the lower right is in shade
    }).join(""),
  );
}
const MOON = moonRows();
export function PixelMoon({ size = 150 }: { size?: number }) {
  return <Grid rows={MOON} size={size} className="moon" />;
}

/** The game's logo: chunky lavender pixel letters with a dark outline and a stepped extrusion (two stacked layers). */
export function Logo({ size = 110, bob = true }: { size?: number; bob?: boolean }) {
  return (
    <h1 className={`logo ${bob ? "bob" : ""}`} style={{ fontSize: size }} aria-label="TRIVELA">
      <span className="logo-back" aria-hidden>
        TRIVELA
      </span>
      <span className="logo-fill" aria-hidden>
        TRIVELA
      </span>
    </h1>
  );
}

/** Sky, sparkles, moon and slow clouds. `sunset` for the menu and the forms, `dusk` (darker, with stands and pitch) during the games. */
export function Backdrop({ variant = "dusk" }: { variant?: "dusk" | "sunset" }) {
  return (
    <div className={`backdrop ${variant}`} aria-hidden>
      <div className="sky" />
      <div className="bd-stars" />
      <div className="bd-stars far" />
      {[
        [7, 14, 0],
        [22, 36, 1.3],
        [41, 9, 2.1],
        [63, 24, 0.7],
        [78, 12, 1.8],
        [90, 38, 2.6],
        [13, 52, 3.1],
        [55, 46, 0.4],
      ].map(([x, y, d], k) => (
        <Sparkle key={k} size={k % 3 === 0 ? 30 : 20} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} />
      ))}
      <div className="moon-wrap">
        <PixelMoon size={variant === "sunset" ? 170 : 110} />
      </div>
      <PixelCloud className="cloud c1" size={86} />
      <PixelCloud variant="b" className="cloud c2" size={64} />
      <PixelCloud className="cloud c3" size={110} />
      <PixelCloud variant="b" className="cloud c4" size={52} />
      {variant === "dusk" && (
        <>
          <div className="bd-beam left" />
          <div className="bd-beam right" />
          <div className="bd-crowd" />
          <div className="bd-pitch" />
          <div className="drift-ball">
            <Sprite name="ball" size={44} />
          </div>
        </>
      )}
      {variant === "sunset" && <div className="bd-hills" />}
    </div>
  );
}

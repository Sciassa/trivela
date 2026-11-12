import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";

const W = 1100;
const H = 560;
const land = feature(world as unknown as Topology, (world as unknown as Topology).objects.countries!);

function projectionFor(center: [number, number], k: number): GeoProjection {
  const p = geoNaturalEarth1().fitSize([W, H], land);
  const base = p.scale();
  p.scale(base * k);
  const [x, y] = p(center)!;
  const [tx, ty] = p.translate();
  p.translate([tx - x + W / 2, ty - y + H / 2]);
  return p;
}

export interface Pin {
  lat: number;
  lon: number;
}

/** Pixel world map: tap to zoom (x4, x16), then tap to place the pin. */
export function WorldMap({
  onConfirm,
  target,
  guess,
  disabled,
}: {
  onConfirm?: (p: Pin) => void;
  target?: { lat: number; lon: number; label: string } | null;
  guess?: Pin | null;
  disabled?: boolean;
}) {
  const [view, setView] = useState<{ c: [number, number]; k: number }>({ c: [10, 20], k: 1 });
  const [pin, setPin] = useState<Pin | null>(null);
  const focus = target && Number.isFinite(target.lat) ? target : null;
  const v = focus && view.k === 1 ? { c: [focus.lon, focus.lat] as [number, number], k: 4 } : view;
  const proj = useMemo(() => projectionFor(v.c, v.k), [v.c, v.k]);
  const path = useMemo(() => geoPath(proj), [proj]);
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (disabled) return;
    const svg = e.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const { x, y } = pt.matrixTransform(ctm.inverse());
    const ll = proj.invert?.([x, y]);
    if (!ll) return;
    if (view.k < 16) setView({ c: [ll[0], ll[1]], k: view.k * 4 });
    else setPin({ lon: ll[0], lat: ll[1] });
  };
  const dot = (p: Pin | null | undefined, color: string, label?: string) => {
    if (!p) return null;
    const xy = proj([p.lon, p.lat]);
    if (!xy) return null;
    return (
      <g>
        <rect x={xy[0] - 7} y={xy[1] - 7} width={14} height={14} fill={color} stroke="#000" strokeWidth={3} />
        {label && (
          <text x={xy[0] + 14} y={xy[1] + 6} fill={color} fontFamily="'Press Start 2P'" fontSize={14}>
            {label}
          </text>
        )}
      </g>
    );
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", maxHeight: 540, background: "#060c1f", border: "4px solid var(--line)", cursor: disabled ? "default" : "crosshair" }}
        shapeRendering="crispEdges"
        onClick={onClick}
      >
        <path d={path(land) ?? ""} fill="#17305e" stroke="#00e5ff" strokeWidth={1} />
        {dot(pin, "var(--accent)")}
        {dot(guess, "var(--accent)")}
        {dot(focus, "var(--ok)", focus?.label)}
      </svg>
      {!disabled && (
        <div className="row">
          <span className="dim grow">{view.k < 16 ? "Tocca la mappa per ingrandire" : "Tocca per piazzare il segnaposto"}</span>
          <button className="btn ghost" onClick={() => (setView({ c: [10, 20], k: 1 }), setPin(null))}>
            MONDO
          </button>
          <button className="btn" disabled={!pin} onClick={() => pin && onConfirm?.(pin)}>
            CONFERMA
          </button>
        </div>
      )}
    </div>
  );
}

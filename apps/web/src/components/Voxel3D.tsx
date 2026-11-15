import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ballModel, exposedFaces, frame, paint, radius, trophyModel, type Vec, type VoxelModel } from "./voxel";

const BALL = ballModel(6);
const CUP = trophyModel();

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A voxel model turning on itself (SPEC §14.2). The canvas is small (`res` pixels) and the page enlarges it with
 * nearest-neighbour sampling: the 3D keeps the pixel-art look. 30 frames a second at most; a single still frame when
 * the player asked for reduced motion.
 */
export function VoxelView({
  model,
  size,
  res = 80,
  rpm = 9,
  tilt = -0.3,
  movingLight = false,
  label,
  className = "",
}: {
  model: VoxelModel;
  size: number;
  res?: number;
  rpm?: number;
  tilt?: number;
  /** The light turns the other way round the model: highlights run over it. */
  movingLight?: boolean;
  label: string;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const faces = useMemo(() => exposedFaces(model), [model]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const scale = (res / 2 - 1) / (radius(model) * 1.08);
    const draw = (t: number) => {
      const spin = (t / 60000) * rpm * Math.PI * 2 + 0.6;
      const la = -spin * 0.6 + 0.9;
      const light: Vec = movingLight ? [Math.sin(la) * 0.9, 0.75, Math.cos(la) * 0.9 + 0.4] : [-0.55, 0.75, 0.65];
      ctx.clearRect(0, 0, res, res);
      paint(ctx, frame(model, faces, spin, tilt, light, scale, res / 2, res / 2));
    };
    if (reducedMotion()) {
      draw(0);
      return;
    }
    let raf = 0;
    let last = -1e9;
    const loop = (t: number) => {
      if (t - last >= 33) {
        last = t;
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [model, faces, res, rpm, tilt, movingLight]);
  return <canvas ref={canvas} className={`voxel ${className}`} width={res} height={res} style={{ width: size, height: size }} role="img" aria-label={label} />;
}

/** The waiting and loading screens: a voxel ball turning slowly. */
export function VoxelBall({ size = 96, className = "" }: { size?: number; className?: string }) {
  return <VoxelView model={BALL} size={size} res={52} rpm={11} tilt={-0.25} label="Caricamento" className={`voxel-ball ${className}`} />;
}

/** The winner's golden cup, turning under a moving light. */
export function VoxelTrophy({ size = 200 }: { size?: number }) {
  return (
    <div className="voxel-trophy" style={{ width: size, height: size }}>
      <VoxelView model={CUP} size={size} res={96} rpm={8} tilt={-0.18} movingLight label="Coppa del vincitore" />
    </div>
  );
}

/**
 * The controller's big button as a pixel-art 3D block (SPEC §14.2): seen from above at an angle, its stacked layers
 * form the stepped sides; pressing it sinks the top along the Z axis (transforms only).
 */
export function Buzz3D({ color, disabled, onPress, children }: { color: string; disabled: boolean; onPress: () => void; children: ReactNode }) {
  const [down, setDown] = useState(false);
  const timer = useRef(0);
  const release = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDown(false), 90); // a quick tap still shows the press
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      className={`buzz3d ${down ? "down" : ""}`}
      disabled={disabled}
      style={{ "--c": color } as CSSProperties}
      onPointerDown={(e) => {
        e.preventDefault();
        if (disabled) return;
        window.clearTimeout(timer.current);
        setDown(true);
        onPress();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <span className="b3" aria-hidden>
        <span className="b3-plate" />
        {Array.from({ length: 7 }, (_, k) => (
          <span key={k} className="b3-layer" style={{ "--k": k, "--a": (0.62 - k * 0.07).toFixed(2) } as CSSProperties} />
        ))}
        <span className="b3-cap">
          <span className="b3-label">{children}</span>
        </span>
      </span>
      <span className="sr-only">{children}</span>
    </button>
  );
}

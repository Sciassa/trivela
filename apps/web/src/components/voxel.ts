/**
 * A tiny voxel renderer for the 3D pixel-art touches (SPEC §14.2): the spinning ball of the waiting screens and the
 * golden cup of the winner. No 3D library: a few hundred cubes, each visible face drawn as a flat-shaded quad on a
 * small canvas that the page scales up with nearest-neighbour sampling, so the pixels stay sharp.
 */

export type Vec = [number, number, number];
export type Rgb = [number, number, number];

export interface VoxelModel {
  /** x, y (up), z, colour index. Coordinates are integers, centred on the origin. */
  voxels: [number, number, number, number][];
  palette: Rgb[];
  /** Colours that shine (gold): they get a specular highlight. */
  shiny?: number[];
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

const FACES: { n: Vec; corners: Vec[] }[] = [
  { n: [1, 0, 0], corners: [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]] },
  { n: [-1, 0, 0], corners: [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]] },
  { n: [0, 1, 0], corners: [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], corners: [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], corners: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
];

/** Faces of a model that touch empty space: the only ones that can ever be seen. */
export function exposedFaces(model: VoxelModel): { at: Vec; face: number; color: number }[] {
  const filled = new Set(model.voxels.map(([x, y, z]) => key(x, y, z)));
  const out: { at: Vec; face: number; color: number }[] = [];
  for (const [x, y, z, c] of model.voxels) {
    FACES.forEach((f, i) => {
      if (!filled.has(key(x + f.n[0], y + f.n[1], z + f.n[2]))) out.push({ at: [x, y, z], face: i, color: c });
    });
  }
  return out;
}

/* ------------------------------------------------------------ models */

/** The twelve directions of an icosahedron: the black patches of a classic ball. */
const ICO: Vec[] = (() => {
  const p = (1 + Math.sqrt(5)) / 2;
  const raw: Vec[] = [
    [0, 1, p], [0, -1, p], [0, 1, -p], [0, -1, -p], [1, p, 0], [-1, p, 0], [1, -p, 0], [-1, -p, 0],
    [p, 0, 1], [-p, 0, 1], [p, 0, -1], [-p, 0, -1],
  ];
  return raw.map(([a, b, c]) => {
    const l = Math.hypot(a, b, c);
    return [a / l, b / l, c / l];
  });
})();

/** A football: a hollow voxel sphere, white with black pentagons. */
export function ballModel(r = 6): VoxelModel {
  const voxels: VoxelModel["voxels"] = [];
  const inside = (x: number, y: number, z: number) => x * x + y * y + z * z <= (r + 0.35) ** 2;
  for (let x = -r; x <= r; x++)
    for (let y = -r; y <= r; y++)
      for (let z = -r; z <= r; z++) {
        if (!inside(x, y, z)) continue;
        if (inside(x + 1, y, z) && inside(x - 1, y, z) && inside(x, y + 1, z) && inside(x, y - 1, z) && inside(x, y, z + 1) && inside(x, y, z - 1)) continue;
        const l = Math.hypot(x, y, z) || 1;
        const best = Math.max(...ICO.map((v) => (v[0] * x + v[1] * y + v[2] * z) / l));
        voxels.push([x, y, z, best > 0.955 ? 1 : 0]);
      }
  return { voxels, palette: [[242, 242, 255], [26, 26, 42]] };
}

/** The winner's cup: a wooden base, a golden stem and a hollow golden cup with two handles. */
export function trophyModel(): VoxelModel {
  const voxels: VoxelModel["voxels"] = [];
  const add = (x: number, y: number, z: number, c: number) => voxels.push([x, y, z, c]);
  const disc = (y: number, r: number, c: number, hollow = 0) => {
    for (let x = -Math.ceil(r); x <= Math.ceil(r); x++)
      for (let z = -Math.ceil(r); z <= Math.ceil(r); z++) {
        const d = Math.hypot(x, z);
        if (d <= r + 0.3 && d >= hollow) add(x, y, z, c);
      }
  };
  const Y0 = -9;
  for (let y = Y0; y < Y0 + 2; y++) for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) add(x, y, z, 2); // wooden plinth
  disc(Y0 + 2, 3, 1); // golden foot
  disc(Y0 + 3, 1.5, 0);
  for (let y = Y0 + 4; y <= Y0 + 6; y++) disc(y, 0.9, 0); // stem
  disc(Y0 + 7, 2, 0); // knot
  disc(Y0 + 8, 2.6, 0); // bottom of the cup
  for (let k = 0; k <= 8; k++) {
    const r = 2.8 + k * 0.38;
    disc(Y0 + 9 + k, r, k === 8 ? 3 : 0, k === 0 ? 0 : r - 1.05); // walls, a brighter rim
  }
  // handles: a loop on each side
  for (const s of [-1, 1]) {
    for (let y = Y0 + 11; y <= Y0 + 15; y++) add(s * 7, y, 0, 0);
    add(s * 6, Y0 + 11, 0, 0);
    add(s * 6, Y0 + 15, 0, 0);
  }
  return { voxels, palette: [[255, 200, 40], [214, 150, 24], [92, 52, 24], [255, 236, 140]], shiny: [0, 1, 3] };
}

/* ------------------------------------------------------------ rendering */

const rotY = ([x, y, z]: Vec, a: number): Vec => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
const rotX = ([x, y, z]: Vec, a: number): Vec => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Vec): Vec => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export interface Quad {
  points: [number, number][];
  depth: number;
  fill: Rgb;
}

/**
 * The quads to draw for one frame, back to front: model turned by `spin` around the vertical axis and tilted by
 * `tilt` towards the viewer, lit from `light` (view space). Faces turned away from the viewer are dropped.
 */
export function frame(model: VoxelModel, faces: ReturnType<typeof exposedFaces>, spin: number, tilt: number, light: Vec, scale: number, cx: number, cy: number): Quad[] {
  const L = norm(light);
  const out: Quad[] = [];
  for (const { at, face, color } of faces) {
    const f = FACES[face]!;
    const n = rotX(rotY(f.n, spin), tilt);
    if (n[2] <= 0.02) continue; // facing away: the viewer looks down the z axis
    const pts = f.corners.map((c) => rotX(rotY([at[0] + c[0], at[1] + c[1], at[2] + c[2]], spin), tilt));
    const base = model.palette[color]!;
    const diffuse = Math.max(0, dot(n, L));
    let k = 0.55 + 0.5 * diffuse;
    let spec = 0;
    if (model.shiny?.includes(color)) {
      // Blinn highlight: the cup glints as it turns under the light
      const h = norm([L[0], L[1], L[2] + 1]);
      spec = Math.pow(Math.max(0, dot(n, h)), 28) * 0.5;
      k += 0.05;
    }
    const fill = base.map((v) => Math.min(255, Math.round(v * k + 255 * spec))) as Rgb;
    out.push({
      points: pts.map((p) => [cx + p[0] * scale, cy - p[1] * scale] as [number, number]),
      depth: pts.reduce((s, p) => s + p[2], 0) / 4,
      fill,
    });
  }
  return out.sort((a, b) => a.depth - b.depth);
}

/** Paint the quads; each one is also stroked in its own colour so that neighbours never show a seam. */
export function paint(ctx: CanvasRenderingContext2D, quads: Quad[]): void {
  ctx.lineWidth = 0.6;
  ctx.lineJoin = "miter";
  for (const q of quads) {
    const c = `rgb(${q.fill[0]},${q.fill[1]},${q.fill[2]})`;
    ctx.fillStyle = c;
    ctx.strokeStyle = c;
    ctx.beginPath();
    q.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** Half the size of the model along its widest axis, to fit it in the canvas. */
export function radius(model: VoxelModel): number {
  let r = 0;
  for (const [x, y, z] of model.voxels) r = Math.max(r, Math.hypot(x, z) + 0.8, Math.abs(y) + 0.8);
  return r;
}

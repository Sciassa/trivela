import { describe, expect, it } from "vitest";
import { ballModel, exposedFaces, frame, radius, trophyModel } from "./voxel";

describe("voxel models (SPEC §14.2)", () => {
  it("the ball is a hollow sphere, mostly white with twelve black patches", () => {
    const m = ballModel(6);
    const black = m.voxels.filter((v) => v[3] === 1).length;
    expect(m.voxels.length).toBeGreaterThan(300);
    expect(m.voxels.length).toBeLessThan(900); // only the shell: a few hundred cubes to draw
    expect(black / m.voxels.length).toBeGreaterThan(0.1);
    expect(black / m.voxels.length).toBeLessThan(0.35);
    // symmetric: every voxel has its mirror image
    const set = new Set(m.voxels.map(([x, y, z]) => `${x},${y},${z}`));
    expect(m.voxels.every(([x, y, z]) => set.has(`${-x},${-y},${-z}`))).toBe(true);
  });
  it("the cup has a wooden base, golden walls that shine, and two handles", () => {
    const m = trophyModel();
    expect(m.shiny).toContain(0);
    expect(m.voxels.some((v) => v[3] === 2)).toBe(true); // wood
    const xs = m.voxels.map((v) => v[0]);
    expect(Math.max(...xs)).toBe(7);
    expect(Math.min(...xs)).toBe(-7); // handles on both sides
    expect(radius(m)).toBeLessThan(12);
  });
  it("only faces touching empty space are drawn, and only those turned to the viewer", () => {
    const m = ballModel(4);
    const faces = exposedFaces(m);
    expect(faces.length).toBeLessThan(m.voxels.length * 6);
    const quads = frame(m, faces, 0.7, -0.3, [0, 1, 1], 4, 40, 40);
    expect(quads.length).toBeGreaterThan(0);
    expect(quads.length).toBeLessThan(faces.length); // the back half is culled
    for (let i = 1; i < quads.length; i++) expect(quads[i]!.depth).toBeGreaterThanOrEqual(quads[i - 1]!.depth); // painter's order
    for (const q of quads) for (const [x, y] of q.points) expect(x >= 0 && x <= 80 && y >= 0 && y <= 80).toBe(true);
  });
  it("a turning light changes the shade of the gold", () => {
    const m = trophyModel();
    const faces = exposedFaces(m);
    const a = frame(m, faces, 0, -0.2, [0, 0.2, 1], 3, 40, 40).map((q) => q.fill.join());
    const b = frame(m, faces, 0, -0.2, [0, 1, 0.2], 3, 40, 40).map((q) => q.fill.join());
    expect(a).not.toEqual(b);
  });
});

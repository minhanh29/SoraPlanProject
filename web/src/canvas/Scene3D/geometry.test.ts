import { describe, expect, it } from "vitest";
import { footprintsOverlap, nearestWallGap, normalizeAngle, overlappingIds, snap, snapAngle, wallPieces } from "./geometry";
import type { SceneWall } from "../../lib/types";

const box = (x: number, z: number, w: number, d: number, r = 0) => ({ position: [x, 0, z] as [number, number, number], rotationY: r, dims: { w, d, h: 1 } });

describe("snapping", () => {
  it("snaps to 5 cm without float noise", () => {
    expect(snap(0.149)).toBe(0.15);
    expect(snap(1.024)).toBe(1.0);
    expect(snap(-0.026)).toBe(-0.05);
  });
  it("snaps angles to 15° and normalizes", () => {
    expect(snapAngle((44 * Math.PI) / 180)).toBeCloseTo((45 * Math.PI) / 180);
    expect(snapAngle((7 * Math.PI) / 180)).toBe(0);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("footprint overlap (SAT)", () => {
  it("detects axis-aligned overlap and separation", () => {
    expect(footprintsOverlap(box(0, 0, 2, 1), box(1.5, 0, 2, 1))).toBe(true);
    expect(footprintsOverlap(box(0, 0, 2, 1), box(2.5, 0, 2, 1))).toBe(false);
  });
  it("treats touching as not overlapping", () => {
    expect(footprintsOverlap(box(0, 0, 2, 1), box(2, 0, 2, 1))).toBe(false);
  });
  it("handles rotation", () => {
    // A 4×0.2 bar rotated 90° covers z∈[-2,2] at x=0; a box at z=1.5 overlaps only when rotated.
    expect(footprintsOverlap(box(0, 0, 4, 0.2, Math.PI / 2), box(0, 1.5, 0.5, 0.5))).toBe(true);
    expect(footprintsOverlap(box(0, 0, 4, 0.2), box(0, 1.5, 0.5, 0.5))).toBe(false);
    // 45° diamond corners do not reach a box placed diagonally beside it
    expect(footprintsOverlap(box(0, 0, 1, 1, Math.PI / 4), box(0.95, 0.95, 0.5, 0.5))).toBe(false);
  });
  it("lists overlapping ids", () => {
    const ids = overlappingIds([
      { id: "a", ...box(0, 0, 1, 1) },
      { id: "b", ...box(0.5, 0, 1, 1) },
      { id: "c", ...box(5, 5, 1, 1) },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});

describe("nearest wall gap", () => {
  const wall: SceneWall = { id: "w1", start: [0, 0], end: [10, 0], thickness: 0.2, height: 2.7, exterior: true };
  it("measures face to face", () => {
    const g = nearestWallGap(box(5, 1, 2, 1), [wall]);
    expect(g?.wallId).toBe("w1");
    expect(g?.gap).toBeCloseTo(1 - 0.5 - 0.1);
  });
  it("uses the rotated extent", () => {
    expect(nearestWallGap(box(5, 1, 2, 1, Math.PI / 2), [wall])?.gap).toBeCloseTo(1 - 1 - 0.1);
  });
});

describe("wall pieces", () => {
  it("is one extended box without openings", () => {
    expect(wallPieces(4, 2.7, 0.2, [])).toEqual([{ u0: -0.1, u1: 4.1, y0: 0, y1: 2.7 }]);
  });
  it("cuts a door with a lintel and a window with sill + lintel", () => {
    const p = wallPieces(6, 2.7, 0.2, [
      { type: "door", offset: 1, width: 0.9, height: 2.1, sillHeight: 0 },
      { type: "window", offset: 4, width: 1.2, height: 1.2, sillHeight: 0.9 },
    ]);
    expect(p).toContainEqual({ u0: -0.1, u1: 0.55, y0: 0, y1: 2.7 });
    expect(p).toContainEqual({ u0: 0.55, u1: 1.45, y0: 2.1, y1: 2.7 });
    expect(p.filter((x) => x.u0 === 3.4 && x.u1 === 4.6).map((x) => [x.y0, x.y1])).toEqual([
      [0, 0.9],
      [2.1, 2.7],
    ]);
    expect(p[p.length - 1]).toEqual({ u0: 4.6, u1: 6.1, y0: 0, y1: 2.7 });
  });
  it("clips to the cutaway height", () => {
    const p = wallPieces(6, 2.7, 0.2, [{ type: "door", offset: 3, width: 1, height: 2.1, sillHeight: 0 }], 1);
    expect(p.every((x) => x.y1 <= 1)).toBe(true);
    expect(p).toHaveLength(2); // lintel is above the cut
  });
});

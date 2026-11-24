import { describe, expect, it } from "vitest";
import type { ItemInstance, SceneGraph, SceneOpening } from "../../lib/types";
import { canStand, walkDelta, walkMove, walkSpace, walkStart } from "./walkthrough";
import { pointInPolygon } from "./geometry";

const item: ItemInstance = { id: "sofa", assetId: null, label: "Sofa", category: null, position: [2, 0, 2], dims: { w: 2, d: 1, h: 1 }, rotationY: Math.PI / 4, scaleMode: "free", addedBy: "parser" };
function house(): SceneGraph {
  return {
    schemaVersion: "1.0", id: "scene", projectId: "p", version: 1, units: "m",
    meta: { style: "Japandi", palette: { wall: "#ffffff", floor: "#aaaaaa", accent: "#333333" }, bounds: { minX: 0, minZ: 0, maxX: 8, maxZ: 6 } },
    levels: [{ id: "ground", name: "Ground", elevation: 0, ceilingHeight: 2.7, items: [], openings: [],
      walls: [{ id: "divider", start: [4, 0], end: [4, 6], thickness: 0.2, height: 2.7, exterior: false }],
      rooms: [{ id: "living", name: "Living", type: "living", area: 24, polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 6 }, { x: 0, z: 6 }] }],
    }],
  };
}
const opening = (type: SceneOpening["type"], height = 2.1): SceneOpening => ({ id: "door", wallId: "divider", type, offset: 3, width: 1, height, sillHeight: type === "window" ? 0.8 : 0 });

describe("walking through the generated house", () => {
  it("passes through doorways and openings, but not windows or low lintels", () => {
    for (const type of ["door", "opening", "window"] as const) {
      const g = house();
      g.levels[0].openings = [opening(type)];
      const end = walkMove(walkSpace(g), [3, 3], [2, 0]);
      if (type === "window") expect(end[0]).toBeLessThan(4);
      else expect(end[0]).toBeCloseTo(5);
    }
    const g = house();
    g.levels[0].openings = [opening("door", 1.2)];
    expect(canStand(walkSpace(g), [4, 3])).toBe(false);
  });

  it("stops at thin walls even with a large movement and slides along them", () => {
    const space = walkSpace(house());
    const [x, z] = walkMove(space, [3, 2], [4, 2]);
    expect(x).toBeLessThanOrEqual(3.7);
    expect(z).toBeCloseTo(4);
    expect(canStand(space, [x, z])).toBe(true);
    expect(canStand(space, [-1, 3])).toBe(false);
    expect(walkMove(space, [1, 1], [-4, -4]).every((v) => v >= 0.2)).toBe(true);
  });

  it("collides with rotated furniture and follows moved and resized items", () => {
    const g = house();
    g.levels[0].items = [structuredClone(item)];
    expect(canStand(walkSpace(g), [2, 2])).toBe(false);
    expect(canStand(walkSpace(g), [3, 3])).toBe(true);
    g.levels[0].items[0].position = [2, 0, 5];
    g.levels[0].items[0].dims = { w: 3, d: 3, h: 1 };
    expect(canStand(walkSpace(g), [2, 2])).toBe(true);
    expect(canStand(walkSpace(g), [2, 5])).toBe(false);
  });

  it("allows floor mats and high wall decorations", () => {
    const g = house();
    g.levels[0].items = [{ ...item, dims: { ...item.dims, h: 0.02 } }, { ...item, id: "art", position: [2, 2, 2] }];
    expect(canStand(walkSpace(g), [2, 2])).toBe(true);
  });

  it("finds clear space in a concave room with an occupied center", () => {
    const g = house();
    const room = g.levels[0].rooms[0];
    room.polygon = [{ x: 0, z: 0 }, { x: 3.8, z: 0 }, { x: 3.8, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 6 }, { x: 0, z: 6 }];
    g.levels[0].items = [item];
    const space = walkSpace(g);
    const start = walkStart(space, room.id)!;
    expect(start).not.toBeNull();
    expect(pointInPolygon(...start, room.polygon)).toBe(true);
    expect(canStand(space, start)).toBe(true);
    expect(walkStart(space, "missing-room")).toBeNull();
    g.levels[0].items = [{ ...item, position: [2, 0, 3], rotationY: 0, dims: { w: 8, d: 8, h: 2 } }];
    expect(walkStart(walkSpace(g))).toBeNull();
  });

  it("uses frame time, normalizes diagonal movement and respects camera direction", () => {
    expect(Math.hypot(...walkDelta(1, 1, 0, 1, false))).toBeCloseTo(1.8);
    expect(walkDelta(1, 0, 0, 1, false)).toEqual([0, -1.8]);
    expect(walkDelta(1, 0, Math.PI / 2, 1, false)[0]).toBeCloseTo(-1.8);
    expect(Math.hypot(...walkDelta(1, 0, 0, 0.5, true))).toBeCloseTo(1.8);
  });
});

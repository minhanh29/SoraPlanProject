import { describe, expect, it } from "vitest";
import { applyOpsLocal, opsStillValid } from "./sceneOps";
import type { ItemInstance, SceneGraph } from "../../lib/types";

const item = (id: string, x = 0): ItemInstance => ({
  id,
  assetId: "ast_sofa",
  label: "Sofa",
  category: "Sofa",
  position: [x, 0, 0],
  rotationY: 0,
  dims: { w: 2, d: 0.9, h: 0.85 },
  scaleMode: "uniform",
  addedBy: "parser",
});

const graph = (): SceneGraph => ({
  schemaVersion: "1.0",
  id: "scn_1",
  projectId: "p1",
  version: 3,
  units: "m",
  meta: { style: "Japandi", palette: { wall: "#EFE8DD", floor: "#C8A57A", accent: "#7D8C6A" }, bounds: { minX: 0, minZ: 0, maxX: 10, maxZ: 8 } },
  levels: [
    {
      id: "lvl_1",
      name: "Ground",
      elevation: 0,
      ceilingHeight: 2.7,
      walls: [{ id: "w1", start: [0, 0], end: [10, 0], thickness: 0.2, height: 2.7, exterior: true, color: "#111111" }],
      openings: [],
      rooms: [{ id: "r1", name: "Living", type: "living", polygon: [], area: 20, floorColor: "#222222" }],
      items: [item("a"), item("b", 3)],
    },
  ],
});

describe("applyOpsLocal", () => {
  it("does not mutate the input", () => {
    const g = graph();
    const before = JSON.stringify(g);
    applyOpsLocal(g, [{ op: "item.move", id: "a", position: [1, 0, 1] }]);
    expect(JSON.stringify(g)).toBe(before);
  });

  it("applies item ops in order", () => {
    const out = applyOpsLocal(graph(), [
      { op: "item.move", id: "a", position: [1, 0, 2] },
      { op: "item.rotate", id: "a", rotationY: Math.PI / 2 },
      { op: "item.resize", id: "a", dims: { w: 2.2, d: 1, h: 0.9 } },
      { op: "item.replace", id: "a", assetId: "ast_other" },
      { op: "item.remove", id: "b" },
      { op: "item.add", item: item("c", 5) },
    ]);
    const items = out.levels[0].items;
    expect(items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(items[0]).toMatchObject({ position: [1, 0, 2], rotationY: Math.PI / 2, dims: { w: 2.2, d: 1, h: 0.9 }, assetId: "ast_other" });
  });

  it("ignores ops on missing items", () => {
    const out = applyOpsLocal(graph(), [{ op: "item.move", id: "zzz", position: [9, 0, 9] }]);
    expect(out.levels[0].items).toHaveLength(2);
  });

  it("item.add replaces an item with the same id", () => {
    const out = applyOpsLocal(graph(), [{ op: "item.add", item: { ...item("a"), label: "New" } }]);
    expect(out.levels[0].items.filter((i) => i.id === "a")).toHaveLength(1);
    expect(out.levels[0].items.find((i) => i.id === "a")?.label).toBe("New");
  });

  it("surface.material: all walls / floors set the palette and clear overrides", () => {
    const out = applyOpsLocal(graph(), [
      { op: "surface.material", target: { allWalls: true }, material: { tint: "#ffffff" } },
      { op: "surface.material", target: { allFloors: true }, material: { tint: "#333333" } },
    ]);
    expect(out.meta.palette.wall).toBe("#ffffff");
    expect(out.meta.palette.floor).toBe("#333333");
    expect(out.levels[0].walls[0].color).toBeNull();
    expect(out.levels[0].rooms[0].floorColor).toBeNull();
  });

  it("surface.material: single wall / room overrides", () => {
    const out = applyOpsLocal(graph(), [
      { op: "surface.material", target: { wallId: "w1" }, material: { tint: "#abcdef" } },
      { op: "surface.material", target: { roomId: "r1" }, material: { tint: null } },
    ]);
    expect(out.levels[0].walls[0].color).toBe("#abcdef");
    expect(out.levels[0].rooms[0].floorColor).toBeNull();
    expect(out.meta.palette.wall).toBe("#EFE8DD");
  });
});

describe("opsStillValid", () => {
  it("requires every referenced item to exist", () => {
    expect(opsStillValid(graph(), [{ op: "item.move", id: "a", position: [0, 0, 0] }])).toBe(true);
    expect(opsStillValid(graph(), [{ op: "item.remove", id: "gone" }])).toBe(false);
    expect(opsStillValid(graph(), [{ op: "item.add", item: item("new") }])).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { FloorPlan } from "../../lib/types";
import { boxesOverlap, buildEditorObjects, exportFloorPlan, findNewOverlap, type BoxObj, type WallObj } from "./model";
import { fitView, toScreen, toWorld, zoomAt } from "./view";
import { distanceToSegment, hitTest, pointInBox, rectHandleAt } from "./hitTest";
import { History } from "./history";
import { resizeBox, snapRotation } from "./interactions";
import { boxFromDrag, makeUserBox } from "./AddBoxTool";
import { isStretched, parseLength, setAxis } from "./mapping";

const plan: FloorPlan = {
  id: "fp_1",
  units: "ft",
  width: 40,
  height: 30,
  rooms: [{ id: "r1", name: "Living", polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] }],
  walls: [{ id: "w1", type: "wall", x1: 0, y1: 0, x2: 40, y2: 0, thickness: 0.5, exterior: true }],
  doors: [],
  windows: [],
  furniture: [
    { id: "f1", type: "furniture", furnitureType: "sofa", label: "Sofa", x: 10, y: 10, width: 8, height: 3, rotation: 90 },
  ],
  fixtures: [{ id: "x1", type: "fixture", fixtureType: "sink", label: "Sink", x: 2, y: 20, width: 2, height: 2, rotation: 0 }],
  metadata: { parsedBy: "test" },
};

describe("view transforms", () => {
  it("round-trips world <-> screen with zoom and pan", () => {
    let v = fitView(40, 30, 800, 600);
    v = zoomAt(v, 2.3, 120, 80);
    v = { ...v, panX: v.panX + 17, panY: v.panY - 9 };
    for (const [x, y] of [[0, 0], [40, 30], [12.5, 7.25]]) {
      const s = toScreen(v, x, y);
      const w = toWorld(v, s.x, s.y);
      expect(w.x).toBeCloseTo(x, 9);
      expect(w.y).toBeCloseTo(y, 9);
    }
  });
  it("zoomAt keeps the point under the cursor fixed", () => {
    const v = fitView(40, 30, 800, 600);
    const before = toWorld(v, 300, 200);
    const after = toWorld(zoomAt(v, 1.7, 300, 200), 300, 200);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
  it("fits the plan centered", () => {
    const v = fitView(40, 30, 880, 680, 40);
    expect(v.s).toBeCloseTo(20);
    expect(toScreen(v, 20, 15)).toEqual({ x: 440, y: 340 });
  });
});

describe("hit testing", () => {
  const objs = buildEditorObjects(plan);
  it("hits a rotated box by its rotated footprint", () => {
    const sofa = objs.find((o) => o.id === "f1") as BoxObj; // center (14, 11.5), rotated 90 → 3 wide, 8 tall
    expect(pointInBox(sofa, 14, 14.5)).toBe(true);
    expect(pointInBox(sofa, 17.5, 11.5)).toBe(false);
    expect(hitTest(objs, 14, 8.2, undefined, 0)?.id).toBe("f1");
    expect(hitTest(objs, 17.5, 11.5, undefined, 0)).toBeNull();
  });
  it("hits walls within half thickness + tolerance", () => {
    expect(hitTest(objs, 20, 0.3, undefined, 0.1)?.id).toBe("w1");
    expect(hitTest(objs, 20, 1, undefined, 0.1)).toBeNull();
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distanceToSegment(-3, 4, 0, 0, 10, 0)).toBe(5);
  });
  it("respects layer visibility", () => {
    const layers = { wall: true, furniture: false, fixture: true, room: true, labels: true, grid: true, overlay: true };
    expect(hitTest(objs, 14, 11.5, layers, 0)).toBeNull();
  });
  it("finds rotate and corner handles of a rect", () => {
    expect(rectHandleAt(100, 100, 60, 40, 0, 100, 100 - 22 - 26)).toBe("rotate");
    expect(rectHandleAt(100, 100, 60, 40, 0, 132, 122)).toBe("resize-br");
    expect(rectHandleAt(100, 100, 60, 40, 90, 78, 132)).toBe("resize-br");
    expect(rectHandleAt(100, 100, 60, 40, 0, 100, 100)).toBeNull();
  });
});

describe("history", () => {
  it("undoes and redoes snapshots, never past the baseline", () => {
    const h = new History<number[]>();
    h.reset([1]);
    expect(h.canUndo).toBe(false);
    h.push([1, 2]);
    h.push([1, 2, 3]);
    h.push([1, 2, 3]); // duplicate ignored
    expect(h.undo()).toEqual([1, 2]);
    expect(h.undo()).toEqual([1]);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual([1, 2]);
    h.push([9]);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toEqual([1, 2]);
  });
});

describe("FloorPlan <-> editor objects", () => {
  it("round-trips geometry and keeps non-editor fields", () => {
    const objs = buildEditorObjects(plan);
    expect(objs.map((o) => o.type)).toEqual(["wall", "furniture", "fixture"]);
    const out = exportFloorPlan(plan, objs);
    expect(out.rooms).toBe(plan.rooms);
    expect(out.metadata).toEqual(plan.metadata);
    expect(out.walls[0]).toMatchObject({ id: "w1", x1: 0, y1: 0, x2: 40, y2: 0, thickness: 0.5, exterior: true });
    expect(out.furniture[0]).toMatchObject({ id: "f1", furnitureType: "sofa", label: "Sofa", x: 10, y: 10, width: 8, height: 3, rotation: 90 });
    expect(out.fixtures[0]).toMatchObject({ id: "x1", fixtureType: "sink", label: "Sink", width: 2 });
  });
  it("exports user boxes with category and addedBy", () => {
    const box = makeUserBox({ x: 1, y: 2, w: 3, h: 4 }, "Dining Chair", "Chair A");
    const out = exportFloorPlan(plan, [...buildEditorObjects(plan), box]);
    const f = out.furniture.find((b) => b.id === box.id)!;
    expect(f).toMatchObject({ category: "Dining Chair", label: "Chair A", addedBy: "user", furnitureType: "unknown", x: 1, y: 2, width: 3, height: 4 });
  });
  it("ignores tiny add-box drags", () => {
    expect(boxFromDrag(1, 1, 1.1, 5, { w: 40, h: 30 })).toBeNull();
    expect(boxFromDrag(5, 6, 1, 2, { w: 40, h: 30 })).toEqual({ x: 1, y: 2, w: 4, h: 4 });
  });
});

describe("interactions", () => {
  it("resizes from a corner keeping the opposite corner fixed", () => {
    const b = buildEditorObjects(plan).find((o) => o.id === "x1") as BoxObj;
    const r = resizeBox(b, "resize-br", 1, 1);
    expect(r).toMatchObject({ x: 2, y: 20, w: 3, h: 3 });
    const l = resizeBox(b, "resize-tl", -1, 0);
    expect(l).toMatchObject({ x: 1, y: 20, w: 3, h: 2 });
  });
  it("snaps rotation", () => {
    expect(snapRotation(47, { shift: false, alt: false })).toBe(45);
    expect(snapRotation(52, { shift: false, alt: false })).toBe(52);
    expect(snapRotation(-3, { shift: false, alt: false })).toBe(0);
    expect(snapRotation(47, { shift: false, alt: true })).toBe(47);
  });
  it("keeps wall shape on export after edits", () => {
    const objs = buildEditorObjects(plan);
    const w = objs[0] as WallObj;
    const moved = { ...w, x2: 35.123 };
    expect(exportFloorPlan(plan, [moved]).walls[0].x2).toBe(35.12);
  });
});

describe("mapping helpers", () => {
  it("parses lengths in cm and ft-in", () => {
    expect(parseLength("210", "m")).toBeCloseTo(2.1);
    expect(parseLength("1.5 m", "m")).toBeCloseTo(1.5);
    expect(parseLength("6'2\"", "ft")).toBeCloseTo((6 * 12 + 2) * 0.0254);
    expect(parseLength("6′2″", "ft")).toBeCloseTo((6 * 12 + 2) * 0.0254);
    expect(parseLength("6.5", "ft")).toBeCloseTo(6.5 * 0.3048);
    expect(parseLength("abc", "m")).toBeNull();
  });
  it("scales all axes with the ratio lock", () => {
    expect(setAxis({ w: 2, d: 1, h: 0.8 }, "w", 3, true)).toEqual({ w: 3, d: 1.5, h: expect.closeTo(1.2) });
    expect(setAxis({ w: 2, d: 1, h: 0.8 }, "w", 3, false)).toEqual({ w: 3, d: 1, h: 0.8 });
  });
  it("detects stretching beyond 20 %", () => {
    const native = { w: 2, d: 1, h: 1 };
    expect(isStretched({ w: 4, d: 2, h: 2 }, native)).toBe(false);
    expect(isStretched({ w: 2.6, d: 1, h: 1 }, native)).toBe(true);
    expect(isStretched({ w: 2.6, d: 1, h: 1 }, null)).toBe(false);
  });
});

describe("box symbol (boxKind)", () => {
  it("comes from the category, then the parsed type, never the label", async () => {
    const { boxKind } = await import("./render");
    // mapped category wins over the parsed type
    expect(boxKind({ subtype: "unknown", category: null }, "Wardrobe & Storage")).toBe("closet");
    expect(boxKind({ subtype: "bed", category: null }, "Nightstand")).toBe("closet");
    // the box's own category (Add box tool)
    expect(boxKind({ subtype: "unknown", category: "Dining Chair" })).toBe("chair");
    // parsed type
    expect(boxKind({ subtype: "bathtub", category: null })).toBe("bath");
    // nothing known: plain box (a label like "Bed linen closet" is not consulted at all)
    expect(boxKind({ subtype: "unknown", category: null })).toBe("other");
  });
});

describe("object overlap", () => {
  const box = (id: string, x: number, y: number, w = 2, h = 2, rotation = 0): BoxObj => ({
    id, type: "furniture", name: id, subtype: "unknown", category: null, x, y, w, h, rotation, confidence: 1, addedBy: "user",
  });
  it("touching is fine, sharing floor is not", () => {
    expect(boxesOverlap(box("a", 0, 0), box("b", 2, 0))).toBe(false);
    expect(boxesOverlap(box("a", 0, 0), box("b", 1.5, 0))).toBe(true);
    expect(boxesOverlap(box("a", 0, 0, 6, 6), box("b", 2, 2))).toBe(true); // on top / inside
  });
  it("uses the rotated footprint", () => {
    // A 45° square's corner reaches 1.41 from its center: clear at a 2.5 gap on the diagonal, not at 1.9
    expect(boxesOverlap(box("a", 0, 0), box("b", 2.5, 2.5, 2, 2, 45))).toBe(false);
    expect(boxesOverlap(box("a", 0, 0), box("b", 1.9, 0, 2, 2, 45))).toBe(true);
  });
  it("blocks only edits that create an overlap", () => {
    const prev = [box("a", 0, 0), box("b", 3, 0), box("c", 10, 0), box("d", 10.5, 0)];
    expect(findNewOverlap(prev, [box("a", 0, 0), box("b", 1, 0), prev[2], prev[3]])?.map((o) => o.id)).toEqual(["b", "a"]);
    expect(findNewOverlap(prev, [...prev, box("e", 0.5, 0.5)])?.[0].id).toBe("e");
    // c and d already overlapped (older parse): renaming c is still allowed
    expect(findNewOverlap(prev, [prev[0], prev[1], { ...prev[2], name: "Sofa" }, prev[3]])).toBeNull();
  });
});

// Editor object model and FloorPlan <-> editor conversion. Pure, no DOM.
import type { FloorPlan, PlanBox, PlanUnits, PlanWall } from "../../lib/types";

export interface WallObj {
  id: string;
  type: "wall";
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  exterior: boolean;
  confidence: number;
}

/** Furniture / fixture box: (x, y) = top-left of the unrotated box, rotation (deg, clockwise) about its center. */
export interface BoxObj {
  id: string;
  type: "furniture" | "fixture";
  name: string;
  subtype: string; // furnitureType / fixtureType
  category: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  confidence: number;
  addedBy: "parser" | "user";
}

export type EditorObject = WallObj | BoxObj;

export const isWall = (o: EditorObject): o is WallObj => o.type === "wall";
export const isBox = (o: EditorObject): o is BoxObj => o.type !== "wall";

export function buildEditorObjects(plan: FloorPlan): EditorObject[] {
  const objs: EditorObject[] = [];
  (plan.walls || []).forEach((w, i) => {
    objs.push({
      id: w.id || `wall_${String(i + 1).padStart(3, "0")}`,
      type: "wall",
      name: w.exterior ? "Exterior wall" : "Interior wall",
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      thickness: w.thickness || (w.exterior ? 0.6 : 0.45),
      exterior: Boolean(w.exterior),
      confidence: w.confidence ?? 0.95,
    });
  });
  const addBox = (b: PlanBox, type: "furniture" | "fixture", i: number) => {
    objs.push({
      id: b.id || `${type === "furniture" ? "fur" : "fix"}_${String(i + 1).padStart(3, "0")}`,
      type,
      name: b.label || (type === "furniture" ? b.furnitureType : b.fixtureType) || (type === "furniture" ? "Furniture" : "Fixture"),
      subtype: (type === "furniture" ? b.furnitureType : b.fixtureType) || "unknown",
      category: b.category ?? null,
      x: b.x,
      y: b.y,
      w: b.width || (type === "furniture" ? 3 : 2),
      h: b.height || (type === "furniture" ? 3 : 2),
      rotation: b.rotation || 0,
      confidence: b.confidence ?? 0.9,
      addedBy: b.addedBy || "parser",
    });
  };
  (plan.furniture || []).forEach((b, i) => addBox(b, "furniture", i));
  (plan.fixtures || []).forEach((b, i) => addBox(b, "fixture", i));
  return objs;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Rebuild a FloorPlan from editor objects, keeping everything the editor does not own (rooms, doors, metadata…). */
export function exportFloorPlan(base: FloorPlan, objects: EditorObject[]): FloorPlan {
  const walls: PlanWall[] = [];
  const furniture: PlanBox[] = [];
  const fixtures: PlanBox[] = [];
  for (const o of objects) {
    if (isWall(o)) {
      walls.push({
        id: o.id,
        type: "wall",
        x1: r2(o.x1),
        y1: r2(o.y1),
        x2: r2(o.x2),
        y2: r2(o.y2),
        thickness: r2(o.thickness || 0.55),
        exterior: o.exterior,
        confidence: o.confidence,
      });
    } else {
      const box: PlanBox = {
        id: o.id,
        type: o.type,
        label: o.name || (o.type === "furniture" ? "Furniture" : "Fixture"),
        category: o.category,
        x: r2(o.x),
        y: r2(o.y),
        width: r2(o.w),
        height: r2(o.h),
        rotation: Math.round(o.rotation || 0),
        confidence: o.confidence,
        addedBy: o.addedBy,
      };
      if (o.type === "furniture") {
        box.furnitureType = o.subtype || "unknown";
        furniture.push(box);
      } else {
        box.fixtureType = o.subtype || "unknown";
        fixtures.push(box);
      }
    }
  }
  return { ...base, walls, furniture, fixtures };
}

export function cloneObjects(objs: EditorObject[]): EditorObject[] {
  return objs.map((o) => ({ ...o }));
}

export function boxCenter(b: BoxObj) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function unitSymbol(units: PlanUnits): string {
  return units === "ft" ? "′" : units === "m" ? " m" : " u";
}

export function fmtPlan(v: number, units: PlanUnits, digits = 1): string {
  return `${v.toFixed(digits)}${unitSymbol(units)}`;
}

export function newBoxId(): string {
  return `box_${Math.random().toString(36).slice(2, 10)}`;
}

function corners(b: BoxObj) {
  const c = boxCenter(b);
  const r = ((b.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [
    [-b.w / 2, -b.h / 2],
    [b.w / 2, -b.h / 2],
    [b.w / 2, b.h / 2],
    [-b.w / 2, b.h / 2],
  ].map(([x, y]) => ({ x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos }));
}

/** True when two (rotated) boxes share floor by more than `eps` plan units (touching is fine). Separating axes. */
export function boxesOverlap(a: BoxObj, b: BoxObj, eps = 0.02): boolean {
  const ca = corners(a);
  const cb = corners(b);
  for (const pts of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      const ax = pts[i + 1].x - pts[i].x;
      const ay = pts[i + 1].y - pts[i].y;
      const len = Math.hypot(ax, ay) || 1;
      const proj = (p: { x: number; y: number }) => (p.x * ax + p.y * ay) / len;
      const pa = ca.map(proj);
      const pb = cb.map(proj);
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= eps) return false;
    }
  }
  return true;
}

/**
 * Objects may not sit on the same spot or on top of each other: the first pair where a box added or changed
 * since `prev` overlaps another box, or null. Pairs that already overlapped in `prev` (e.g. an older parse)
 * do not block unrelated edits.
 */
export function findNewOverlap(prev: EditorObject[], next: EditorObject[]): [BoxObj, BoxObj] | null {
  const before = new Map(prev.filter(isBox).map((o) => [o.id, o as BoxObj]));
  const boxes = next.filter(isBox) as BoxObj[];
  for (const a of boxes) {
    const old = before.get(a.id);
    if (old && JSON.stringify(old) === JSON.stringify(a)) continue;
    for (const b of boxes) {
      if (b.id === a.id || !boxesOverlap(a, b)) continue;
      const oldB = before.get(b.id);
      if (old && oldB && boxesOverlap(old, oldB)) continue;
      return [a, b];
    }
  }
  return null;
}

/** Normalize a dragged rectangle (any corner order) into a box. */
export function rectFromDrag(ax: number, ay: number, bx: number, by: number) {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

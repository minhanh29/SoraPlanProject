// Drag state machine for the plan canvas. Pure: given a drag + pointer, returns the updated object.
import type { BoxObj, EditorObject, WallObj } from "./model";
import type { ResizeHandle } from "./hitTest";

export type Drag =
  | { mode: "pan"; startX: number; startY: number; origPanX: number; origPanY: number }
  | { mode: "move"; id: string; dx: number; dy: number; moved: boolean }
  | { mode: "resize"; handle: ResizeHandle; id: string; orig: BoxObj; startX: number; startY: number }
  | { mode: "rotate"; id: string; cx: number; cy: number; origRot: number; startAngle: number }
  | { mode: "wall-p1" | "wall-p2"; id: string }
  | { mode: "addBox"; ax: number; ay: number; bx: number; by: number }
  | {
      mode: "footprint";
      id: string;
      handle: ResizeHandle;
      cx: number;
      cy: number;
      rotation: number; // deg, footprint rotation in plan
      origW: number; // plan units
      origD: number;
      startDist: number;
    };

export interface Mods {
  shift: boolean;
  alt: boolean;
}

const MIN_SIZE = 0.3;
const round = (v: number, step = 0.01) => Math.round(v / step) * step;

export function moveBox(o: BoxObj, wx: number, wy: number, d: { dx: number; dy: number }, bounds: { w: number; h: number }): BoxObj {
  // Keep the center inside the plan so a box can never get lost off-canvas.
  const cx = Math.max(0, Math.min(bounds.w, wx - d.dx + o.w / 2));
  const cy = Math.max(0, Math.min(bounds.h, wy - d.dy + o.h / 2));
  return { ...o, x: round(cx - o.w / 2), y: round(cy - o.h / 2) };
}

export function moveWall(o: WallObj, dx: number, dy: number): WallObj {
  return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
}

/** Resize a rotated box from one handle; the opposite side stays fixed. */
export function resizeBox(orig: BoxObj, handle: ResizeHandle, dwx: number, dwy: number): BoxObj {
  const rad = ((orig.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ldx = cos * dwx + sin * dwy;
  const ldy = -sin * dwx + cos * dwy;
  let w = orig.w;
  let h = orig.h;
  let cxl = 0;
  let cyl = 0;
  const right = handle === "resize-r" || handle === "resize-tr" || handle === "resize-br";
  const left = handle === "resize-l" || handle === "resize-tl" || handle === "resize-bl";
  const bottom = handle === "resize-b" || handle === "resize-bl" || handle === "resize-br";
  const top = handle === "resize-t" || handle === "resize-tl" || handle === "resize-tr";
  if (right) {
    w = Math.max(MIN_SIZE, orig.w + ldx);
    cxl = (w - orig.w) / 2;
  } else if (left) {
    w = Math.max(MIN_SIZE, orig.w - ldx);
    cxl = -(w - orig.w) / 2;
  }
  if (bottom) {
    h = Math.max(MIN_SIZE, orig.h + ldy);
    cyl = (h - orig.h) / 2;
  } else if (top) {
    h = Math.max(MIN_SIZE, orig.h - ldy);
    cyl = -(h - orig.h) / 2;
  }
  const cx = orig.x + orig.w / 2 + cos * cxl - sin * cyl;
  const cy = orig.y + orig.h / 2 + sin * cxl + cos * cyl;
  w = round(w);
  h = round(h);
  return { ...orig, w, h, x: round(cx - w / 2), y: round(cy - h / 2) };
}

/** Rotation snapping: 45° (15° with Shift) within a threshold; Alt disables snapping. */
export function snapRotation(deg: number, mods: Mods): number {
  let r = ((Math.round(deg) % 360) + 360) % 360;
  if (!mods.alt) {
    const step = mods.shift ? 15 : 45;
    const near = Math.round(r / step) * step;
    if (Math.abs(r - near) <= (mods.shift ? 7.5 : 6)) r = near;
  }
  return ((r % 360) + 360) % 360;
}

export function rotateBox(o: BoxObj, d: Extract<Drag, { mode: "rotate" }>, wx: number, wy: number, mods: Mods): BoxObj {
  const a = Math.atan2(wy - d.cy, wx - d.cx);
  return { ...o, rotation: snapRotation(d.origRot + ((a - d.startAngle) * 180) / Math.PI, mods) };
}

export function dragWallEnd(o: WallObj, end: "wall-p1" | "wall-p2", wx: number, wy: number): WallObj {
  const x = Math.round(wx * 10) / 10;
  const y = Math.round(wy * 10) / 10;
  return end === "wall-p1" ? { ...o, x1: x, y1: y } : { ...o, x2: x, y2: y };
}

/**
 * Footprint scaling (mapping mode): the footprint stays centered on the box; dragging a corner/edge sets
 * its half-extent to the pointer. With `lock` the scale is uniform (distance ratio from the center).
 */
export function scaleFootprint(d: Extract<Drag, { mode: "footprint" }>, wx: number, wy: number, lock: boolean) {
  const rad = -(d.rotation * Math.PI) / 180;
  const dx = wx - d.cx;
  const dy = wy - d.cy;
  const lx = Math.cos(rad) * dx - Math.sin(rad) * dy;
  const ly = Math.sin(rad) * dx + Math.cos(rad) * dy;
  if (lock) {
    const f = Math.max(0.1, Math.hypot(lx, ly) / Math.max(d.startDist, 1e-6));
    return { w: d.origW * f, d: d.origD * f, factor: f };
  }
  const horiz = d.handle !== "resize-t" && d.handle !== "resize-b";
  const vert = d.handle !== "resize-l" && d.handle !== "resize-r";
  const w = horiz ? Math.max(MIN_SIZE / 3, Math.abs(lx) * 2) : d.origW;
  const dd = vert ? Math.max(MIN_SIZE / 3, Math.abs(ly) * 2) : d.origD;
  return { w, d: dd, factor: null as number | null };
}

export function replaceObject(objects: EditorObject[], next: EditorObject): EditorObject[] {
  return objects.map((o) => (o.id === next.id ? next : o));
}

// Hit testing in world and screen space. Pure.
import { isWall, type BoxObj, type EditorObject } from "./model";
import { scaleOf, toScreen, type View } from "./view";

export type ResizeHandle =
  | "resize-tl" | "resize-tr" | "resize-br" | "resize-bl"
  | "resize-t" | "resize-b" | "resize-l" | "resize-r";
export type Handle = ResizeHandle | "rotate" | "wall-p1" | "wall-p2";

export interface LayerVisibility {
  wall: boolean;
  furniture: boolean;
  fixture: boolean;
  room: boolean;
  labels: boolean;
  grid: boolean;
  overlay: boolean;
}

export const DEFAULT_LAYERS: LayerVisibility = {
  wall: true,
  furniture: true,
  fixture: true,
  room: true,
  labels: true,
  grid: true,
  overlay: true,
};

export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/** Point in the box's local (unrotated, center-origin) frame. */
export function toLocal(b: Pick<BoxObj, "x" | "y" | "w" | "h" | "rotation">, wx: number, wy: number) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rad = -((b.rotation || 0) * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  return { x: Math.cos(rad) * dx - Math.sin(rad) * dy, y: Math.sin(rad) * dx + Math.cos(rad) * dy };
}

export function pointInBox(b: BoxObj, wx: number, wy: number, pad = 0): boolean {
  const l = toLocal(b, wx, wy);
  return Math.abs(l.x) <= b.w / 2 + pad && Math.abs(l.y) <= b.h / 2 + pad;
}

/**
 * Topmost object at a world point: boxes first (last drawn wins), then walls.
 * `tolerance` is in world units (≈ a few screen pixels).
 */
export function hitTest(
  objects: EditorObject[],
  wx: number,
  wy: number,
  layers: LayerVisibility = DEFAULT_LAYERS,
  tolerance = 0.2,
): EditorObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (isWall(o) || !layers[o.type]) continue;
    if (pointInBox(o, wx, wy, tolerance)) return o;
  }
  if (layers.wall) {
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (!isWall(o)) continue;
      if (distanceToSegment(wx, wy, o.x1, o.y1, o.x2, o.y2) <= (o.thickness || 0.5) / 2 + tolerance) return o;
    }
  }
  return null;
}

export const ROTATE_STEM = 26;

/** Handle of a rotated rectangle under a screen point. `cx, cy, w, h` in screen px. */
export function rectHandleAt(
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotationDeg: number,
  sx: number,
  sy: number,
  opts: { rotate?: boolean; edges?: boolean } = { rotate: true, edges: true },
): ResizeHandle | "rotate" | null {
  const rad = -(rotationDeg * Math.PI) / 180;
  const dx = sx - cx;
  const dy = sy - cy;
  const lx = Math.cos(rad) * dx - Math.sin(rad) * dy;
  const ly = Math.sin(rad) * dx + Math.cos(rad) * dy;
  const pad = 2;
  const bw = w + pad * 2;
  const bh = h + pad * 2;
  const bx = -bw / 2;
  const by = -bh / 2;

  if (opts.rotate !== false) {
    if (Math.hypot(lx, ly - (by - ROTATE_STEM)) <= 12 || (Math.abs(lx) <= 6 && ly >= by - ROTATE_STEM && ly <= by - 4)) {
      return "rotate";
    }
  }
  const hitR = Math.min(11, Math.max(5, Math.min(bw, bh) * 0.42));
  const corners: [ResizeHandle, number, number][] = [
    ["resize-tl", bx, by],
    ["resize-tr", bx + bw, by],
    ["resize-br", bx + bw, by + bh],
    ["resize-bl", bx, by + bh],
  ];
  let best: ResizeHandle | null = null;
  let bestD = Infinity;
  for (const [hname, x, y] of corners) {
    const d = Math.hypot(lx - x, ly - y);
    if (d <= hitR && d < bestD) {
      bestD = d;
      best = hname;
    }
  }
  if (best) return best;
  if (opts.edges === false) return null;
  const half = 9;
  const thick = 6;
  if (bh >= 18) {
    if (Math.abs(lx) <= half && Math.abs(ly - by) <= thick) return "resize-t";
    if (Math.abs(lx) <= half && Math.abs(ly - (by + bh)) <= thick) return "resize-b";
  }
  if (Math.abs(ly) <= Math.max(half, bh / 2) && Math.abs(lx - bx) <= thick) return "resize-l";
  if (Math.abs(ly) <= Math.max(half, bh / 2) && Math.abs(lx - (bx + bw)) <= thick) return "resize-r";
  return null;
}

/** Handle of the selected object under a screen point (edit mode). */
export function handleAt(o: EditorObject, sx: number, sy: number, view: View): Handle | null {
  if (isWall(o)) {
    const p1 = toScreen(view, o.x1, o.y1);
    const p2 = toScreen(view, o.x2, o.y2);
    if (Math.hypot(sx - p1.x, sy - p1.y) <= 10) return "wall-p1";
    if (Math.hypot(sx - p2.x, sy - p2.y) <= 10) return "wall-p2";
    return null;
  }
  const k = scaleOf(view);
  const c = toScreen(view, o.x + o.w / 2, o.y + o.h / 2);
  return rectHandleAt(c.x, c.y, o.w * k, o.h * k, o.rotation || 0, sx, sy);
}

export function resizeCursor(handle: string, rotation = 0): string {
  const base: Record<string, number> = {
    "resize-r": 0, "resize-br": 45, "resize-b": 90, "resize-bl": 135,
    "resize-l": 180, "resize-tl": 225, "resize-t": 270, "resize-tr": 315,
  };
  const b = base[handle];
  if (b === undefined) return "default";
  const norm = ((((b + rotation) % 360) + 360) % 360 + 22.5) % 180;
  if (norm < 45) return "ew-resize";
  if (norm < 90) return "nwse-resize";
  if (norm < 135) return "ns-resize";
  return "nesw-resize";
}

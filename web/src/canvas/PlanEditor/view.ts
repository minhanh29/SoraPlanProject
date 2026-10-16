// World (plan units) <-> screen (CSS px) transform. Pure.
export interface View {
  s: number; // base fit scale (px per plan unit)
  ox: number;
  oy: number;
  zoom: number;
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 10;

export const scaleOf = (v: View) => v.s * v.zoom;

export function toScreen(v: View, wx: number, wy: number) {
  const k = scaleOf(v);
  return { x: v.ox + v.panX + wx * k, y: v.oy + v.panY + wy * k };
}

export function toWorld(v: View, sx: number, sy: number) {
  const k = scaleOf(v);
  return { x: (sx - v.ox - v.panX) / k, y: (sy - v.oy - v.panY) / k };
}

export function fitView(planW: number, planH: number, rectW: number, rectH: number, pad = 40): View {
  const usableW = Math.max(60, rectW - pad * 2);
  const usableH = Math.max(60, rectH - pad * 2);
  const s = Math.min(usableW / Math.max(planW, 1e-6), usableH / Math.max(planH, 1e-6));
  return { s, zoom: 1, panX: 0, panY: 0, ox: (rectW - planW * s) / 2, oy: (rectH - planH * s) / 2 };
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed. */
export function zoomAt(v: View, factor: number, sx: number, sy: number): View {
  const before = toWorld(v, sx, sy);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
  const k = v.s * zoom;
  return { ...v, zoom, panX: sx - v.ox - before.x * k, panY: sy - v.oy - before.y * k };
}

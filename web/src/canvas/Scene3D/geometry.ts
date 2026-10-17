// Pure scene geometry helpers (no three.js): snapping, item footprints (OBB), wall pieces, wall distance.
// Plan coordinates are (x, z) in meters; rotationY is radians about +Y (three.js convention).

import type { Dims, SceneOpening, SceneWall, Vec3 } from "../../lib/types";

export const MOVE_SNAP = 0.05; // 5 cm
export const ROTATE_SNAP_DEG = 15;
export const SCALE_MIN = 0.2;
export const SCALE_MAX = 3;

export function snap(v: number, step = MOVE_SNAP): number {
  const s = Math.round(v / step) * step;
  return Math.round(s * 1e6) / 1e6; // keep 0.15 from becoming 0.15000000000000002
}

/** Snap an angle (radians) to `stepDeg` and normalize to (-π, π]. */
export function snapAngle(rad: number, stepDeg = ROTATE_SNAP_DEG): number {
  const step = (stepDeg * Math.PI) / 180;
  return normalizeAngle(Math.round(rad / step) * step);
}

export function normalizeAngle(rad: number): number {
  let r = rad % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return Math.abs(r) < 1e-9 ? 0 : r;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------- footprints

export interface Footprint {
  position: Vec3;
  rotationY: number;
  dims: Dims;
}

/** World (x, z) directions of the item's local X and Z axes. */
export function itemAxes(rotationY: number): { ax: [number, number]; az: [number, number] } {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  // Rotating (1,0,0) about +Y by r gives (cos r, 0, -sin r); (0,0,1) gives (sin r, 0, cos r).
  return { ax: [c, -s], az: [s, c] };
}

export function footprintCorners(f: Footprint): [number, number][] {
  const { ax, az } = itemAxes(f.rotationY);
  const hw = f.dims.w / 2;
  const hd = f.dims.d / 2;
  const cx = f.position[0];
  const cz = f.position[2];
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz]) => [cx + ax[0] * hw * sx + az[0] * hd * sz, cz + ax[1] * hw * sx + az[1] * hd * sz]);
}

/** Separating-axis test for two item footprints. Touching (within `eps` m) does not count as overlap. */
export function footprintsOverlap(a: Footprint, b: Footprint, eps = 0.01): boolean {
  const ca = footprintCorners(a);
  const cb = footprintCorners(b);
  const axes = [itemAxes(a.rotationY), itemAxes(b.rotationY)].flatMap((x) => [x.ax, x.az]);
  for (const [nx, nz] of axes) {
    const pa = ca.map(([x, z]) => x * nx + z * nz);
    const pb = cb.map(([x, z]) => x * nx + z * nz);
    const overlap = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
    if (overlap <= eps) return false;
  }
  return true;
}

/** Ids of items whose footprint overlaps another item's. */
export function overlappingIds<T extends Footprint & { id: string }>(items: T[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (footprintsOverlap(items[i], items[j])) {
        out.add(items[i].id);
        out.add(items[j].id);
      }
  return out;
}

/**
 * Nearest position to `start` (x, z) where `f` overlaps none of `others`, searched on rings of `step` m
 * (same idea as the backend add_item tool). Falls back to `start`.
 */
export function freeSpot(f: Omit<Footprint, "position">, start: [number, number], others: Footprint[], step = 0.15, rings = 25): [number, number] {
  for (let ring = 0; ring < rings; ring++) {
    const n = ring === 0 ? 1 : 8 * ring;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const x = snap(start[0] + ring * step * Math.cos(a));
      const z = snap(start[1] + ring * step * Math.sin(a));
      const mine = { ...f, position: [x, 0, z] as Vec3 };
      if (!others.some((o) => footprintsOverlap(mine, o))) return [x, z];
    }
  }
  return start;
}

/** Even-odd point-in-polygon test on the floor plane. */
export function pointInPolygon(x: number, z: number, poly: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/** Half extent of a footprint along a unit direction (nx, nz). */
function halfExtentAlong(f: Footprint, nx: number, nz: number): number {
  const { ax, az } = itemAxes(f.rotationY);
  return Math.abs((f.dims.w / 2) * (ax[0] * nx + ax[1] * nz)) + Math.abs((f.dims.d / 2) * (az[0] * nx + az[1] * nz));
}

/** Clear gap (m) between the footprint and the closest wall face; negative when it intersects a wall. */
export function nearestWallGap(f: Footprint, walls: SceneWall[]): { gap: number; wallId: string } | null {
  let best: { gap: number; wallId: string } | null = null;
  const px = f.position[0];
  const pz = f.position[2];
  for (const w of walls) {
    const [x1, z1] = w.start;
    const [x2, z2] = w.end;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? clamp(((px - x1) * dx + (pz - z1) * dz) / l2, 0, 1) : 0;
    const qx = x1 + t * dx;
    const qz = z1 + t * dz;
    const dist = Math.hypot(px - qx, pz - qz);
    let nx: number;
    let nz: number;
    if (dist > 1e-6) {
      nx = (px - qx) / dist;
      nz = (pz - qz) / dist;
    } else if (l2 > 0) {
      const l = Math.sqrt(l2);
      nx = -dz / l;
      nz = dx / l;
    } else continue;
    const gap = dist - halfExtentAlong(f, nx, nz) - w.thickness / 2;
    if (!best || gap < best.gap) best = { gap, wallId: w.id };
  }
  return best;
}

// ---------------------------------------------------------------- walls

/** One solid box of a wall in wall-local coordinates: u along start→end (m), y up. */
export interface WallPiece {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

/**
 * Cut a wall into solid pieces around its openings. Ends are extended by thickness/2 so corners close.
 * Doors/openings leave a gap from the floor to `height` (lintel above); windows keep a sill below `sillHeight`
 * and a lintel above `sillHeight + height`. `cutHeight` clips everything (cutaway view).
 */
export function wallPieces(
  length: number,
  height: number,
  thickness: number,
  openings: Pick<SceneOpening, "type" | "offset" | "width" | "height" | "sillHeight">[],
  cutHeight?: number,
): WallPiece[] {
  const H = height;
  const ext = thickness / 2;
  const pieces: WallPiece[] = [];
  let cursor = -ext;
  const sorted = [...openings].sort((a, b) => a.offset - b.offset);
  for (const o of sorted) {
    const a = clamp(o.offset - o.width / 2, 0, length);
    const b = clamp(o.offset + o.width / 2, 0, length);
    if (b - a < 0.01) continue;
    if (a > cursor) pieces.push({ u0: cursor, u1: a, y0: 0, y1: H });
    const start = Math.max(a, cursor);
    if (b > start) {
      if (o.type === "window") {
        if (o.sillHeight > 0) pieces.push({ u0: start, u1: b, y0: 0, y1: Math.min(o.sillHeight, H) });
        const top = o.sillHeight + o.height;
        if (top < H) pieces.push({ u0: start, u1: b, y0: top, y1: H });
      } else {
        const top = o.height > 0 ? o.height : 2.1;
        if (top < H) pieces.push({ u0: start, u1: b, y0: top, y1: H });
      }
    }
    cursor = Math.max(cursor, b);
  }
  if (length + ext > cursor) pieces.push({ u0: cursor, u1: length + ext, y0: 0, y1: H });
  const cut = cutHeight ?? H;
  return pieces
    .map((p) => ({ ...p, y1: Math.min(p.y1, cut) }))
    .filter((p) => p.y1 - p.y0 > 0.01 && p.u1 - p.u0 > 0.005);
}

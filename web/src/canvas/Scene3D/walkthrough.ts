import type { SceneGraph, SceneRoom } from "../../lib/types";
import { clamp, pointInPolygon, wallPieces } from "./geometry";

export type FloorPoint = [number, number];
export const WALK_RADIUS = 0.2;

interface Obstacle {
  x: number;
  z: number;
  cos: number;
  sin: number;
  halfW: number;
  halfD: number;
}

export interface WalkSpace {
  bounds: SceneGraph["meta"]["bounds"];
  rooms: SceneRoom[];
  obstacles: Obstacle[];
  eyeHeight: number;
}

/** Use the same wall solids as the renderer: doorways stay passable, windows stay solid. */
export function walkSpace(graph: SceneGraph): WalkSpace {
  const level = graph.levels[0];
  const eyeHeight = Math.max(0.5, Math.min(1.65, (level?.ceilingHeight || 2.7) - 0.2));
  const obstacles: Obstacle[] = [];
  for (const wall of level?.walls || []) {
    const dx = wall.end[0] - wall.start[0];
    const dz = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.001) continue;
    for (const p of wallPieces(length, wall.height, wall.thickness, (level?.openings || []).filter((o) => o.wallId === wall.id))) {
      if (p.y0 >= eyeHeight + 0.12 || p.y1 <= 0.08) continue;
      const u = (p.u0 + p.u1) / 2;
      obstacles.push({
        x: wall.start[0] + (dx * u) / length,
        z: wall.start[1] + (dz * u) / length,
        cos: dx / length,
        sin: -dz / length,
        halfW: (p.u1 - p.u0) / 2,
        halfD: wall.thickness / 2,
      });
    }
  }
  for (const it of level?.items || []) {
    // Floor mats can be walked over; wall-mounted objects above the head do not block walking.
    if (it.position[1] + it.dims.h <= 0.08 || it.position[1] >= eyeHeight + 0.12) continue;
    obstacles.push({ x: it.position[0], z: it.position[2], cos: Math.cos(it.rotationY), sin: Math.sin(it.rotationY), halfW: it.dims.w / 2, halfD: it.dims.d / 2 });
  }
  return { bounds: graph.meta.bounds, rooms: level?.rooms || [], obstacles, eyeHeight };
}

export function canStand(space: WalkSpace, [x, z]: FloorPoint): boolean {
  const b = space.bounds;
  if (x < b.minX + WALK_RADIUS || x > b.maxX - WALK_RADIUS || z < b.minZ + WALK_RADIUS || z > b.maxZ - WALK_RADIUS) return false;
  return !space.obstacles.some((o) => {
    const dx = x - o.x, dz = z - o.z;
    const lx = dx * o.cos - dz * o.sin;
    const lz = dx * o.sin + dz * o.cos;
    const gapX = lx - clamp(lx, -o.halfW, o.halfW);
    const gapZ = lz - clamp(lz, -o.halfD, o.halfD);
    return gapX * gapX + gapZ * gapZ < WALK_RADIUS * WALK_RADIUS;
  });
}

/** Search inside the actual room polygon, including concave rooms and furnished centers. */
export function walkStart(space: WalkSpace, roomId?: string): FloorPoint | null {
  const rooms = roomId ? space.rooms.filter((r) => r.id === roomId) : [...space.rooms].sort((a, b) => b.area - a.area);
  const regions = rooms.length ? rooms.map((r) => r.polygon) : roomId ? [] : [
    [{ x: space.bounds.minX, z: space.bounds.minZ }, { x: space.bounds.maxX, z: space.bounds.minZ }, { x: space.bounds.maxX, z: space.bounds.maxZ }, { x: space.bounds.minX, z: space.bounds.maxZ }],
  ];
  for (const polygon of regions) {
    if (polygon.length < 3) continue;
    const minX = Math.min(...polygon.map((p) => p.x)), maxX = Math.max(...polygon.map((p) => p.x));
    const minZ = Math.min(...polygon.map((p) => p.z)), maxZ = Math.max(...polygon.map((p) => p.z));
    const center: FloorPoint = [(minX + maxX) / 2, (minZ + maxZ) / 2];
    const candidates: FloorPoint[] = [center];
    const nx = Math.min(64, Math.max(1, Math.ceil((maxX - minX) / 0.25)));
    const nz = Math.min(64, Math.max(1, Math.ceil((maxZ - minZ) / 0.25)));
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      candidates.push([minX + ((ix + 0.5) * (maxX - minX)) / nx, minZ + ((iz + 0.5) * (maxZ - minZ)) / nz]);
    }
    candidates.sort((a, b) => Math.hypot(a[0] - center[0], a[1] - center[1]) - Math.hypot(b[0] - center[0], b[1] - center[1]));
    const start = candidates.find((p) => pointInPolygon(p[0], p[1], polygon) && canStand(space, p));
    if (start) return start;
  }
  return null;
}

/** Small steps prevent tunneling; separate axes let the visitor slide along walls. */
export function walkMove(space: WalkSpace, position: FloorPoint, delta: FloorPoint): FloorPoint {
  let [x, z] = position;
  const steps = Math.max(1, Math.ceil(Math.hypot(...delta) / (WALK_RADIUS / 2)));
  const dx = delta[0] / steps, dz = delta[1] / steps;
  for (let i = 0; i < steps; i++) {
    if (canStand(space, [x + dx, z])) x += dx;
    if (canStand(space, [x, z + dz])) z += dz;
  }
  return [x, z];
}

/** Camera-relative walking at a consistent speed, including diagonal movement. */
export function walkDelta(forward: number, right: number, yaw: number, seconds: number, fast: boolean): FloorPoint {
  const scale = (seconds * (fast ? 3.6 : 1.8)) / Math.max(1, Math.hypot(forward, right));
  return [(right * Math.cos(yaw) - forward * Math.sin(yaw)) * scale, (-right * Math.sin(yaw) - forward * Math.cos(yaw)) * scale];
}

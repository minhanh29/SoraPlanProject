// Cinematic house tour: plan a shot list from the scene graph and sample it at any time t (seconds).
// Pure (no three.js), so the same plan drives the live preview and the frame-exact video export.
//
// Shot list (real-estate clip grammar): aerial establishing orbit with the title → one slow interior move
// per room at eye height (dolly-in or lateral slide, alternating) with the room name → aerial pull-back.
// Shots are joined by short dips to black.

import type { ItemInstance, SceneGraph, SceneRoom, SceneWall, Vec3 } from "../../lib/types";
import { footprintCorners, pointInPolygon } from "./geometry";

export interface Pose {
  pos: Vec3;
  target: Vec3;
}

export interface Caption {
  title: string;
  subtitle?: string;
  /** "title" = centered title card (intro/outro), "lower" = lower-third room name. */
  style: "title" | "lower";
}

export interface Shot {
  kind: "aerial" | "interior";
  duration: number;
  from: Pose;
  to: Pose;
  /** Aerial shots orbit the house instead of moving in a straight line. */
  orbit?: { center: [number, number]; targetY: number; radius: [number, number]; height: [number, number]; az: [number, number] };
  /** Vertical field of view, degrees. */
  fov: number;
  caption: Caption | null;
  roomId?: string;
}

export interface Tour {
  shots: Shot[];
  duration: number;
}

export interface TourFrame {
  position: Vec3;
  target: Vec3;
  fov: number;
  /** Interior shot: ceilings and room lights on. */
  interior: boolean;
  /** 0 = clear, 1 = black. */
  fade: number;
  caption: Caption | null;
  captionAlpha: number;
  shotIndex: number;
}

export const EYE_HEIGHT = 1.45;
const LOOK_HEIGHT = 0.95;
const AERIAL_S = 7;
const ROOM_S = 5;
const OUTRO_S = 6;
const DIP_S = 0.3; // half of a dip to black between shots
const MAX_ROOMS = 8;
const MIN_ROOM_AREA = 3; // m²
const WALL_CLEARANCE = 0.3; // camera stays this far from wall centerlines

/** Rooms in tour order: living spaces first, then bedrooms, bathrooms last. */
const ROOM_ORDER: Record<string, number> = { living: 0, dining: 1, kitchen: 2, bedroom: 3, office: 4, bathroom: 5, other: 6 };

const deg = (d: number) => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Slow in, slow out: the camera never starts or stops abruptly. */
export const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

function centroid(poly: { x: number; z: number }[]): [number, number] {
  // Area centroid (vertex average drifts toward dense corners)
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.z - q.x * p.z;
    a += f;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p.x, 0) / poly.length, poly.reduce((s, p) => s + p.z, 0) / poly.length];
  return [cx / (3 * a), cz / (3 * a)];
}

function distToSegment(px: number, pz: number, w: SceneWall): number {
  const [x1, z1] = w.start;
  const [x2, z2] = w.end;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - x1) * dx + (pz - z1) * dz) / l2)) : 0;
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

/** A camera spot inside the room, clear of walls and of tall furniture. */
function spotOk(x: number, z: number, room: SceneRoom, walls: SceneWall[], tall: ItemInstance[]): boolean {
  if (!pointInPolygon(x, z, room.polygon)) return false;
  if (walls.some((w) => distToSegment(x, z, w) < WALL_CLEARANCE + w.thickness / 2)) return false;
  return !tall.some((it) => {
    const c = footprintCorners({ ...it, dims: { ...it.dims, w: it.dims.w + 0.3, d: it.dims.d + 0.3 } });
    return pointInPolygon(x, z, c.map(([px, pz]) => ({ x: px, z: pz })));
  });
}

function interiorShot(room: SceneRoom, walls: SceneWall[], items: ItemInstance[], index: number): Shot | null {
  const [cx, cz] = centroid(room.polygon);
  // Furniture the camera (at eye height) would sit inside
  const tall = items.filter((it) => it.dims.h > EYE_HEIGHT - 0.2);
  // Candidate spots: each corner pulled toward the centre; prefer the one that sees the most of the room
  const candidates: { x: number; z: number; d: number }[] = [];
  for (const v of room.polygon) {
    const dx = cx - v.x;
    const dz = cz - v.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.8) continue;
    for (const inset of [0.55, 0.8, 1.1]) {
      const x = v.x + (dx / len) * inset;
      const z = v.z + (dz / len) * inset;
      if (spotOk(x, z, room, walls, tall)) {
        candidates.push({ x, z, d: Math.hypot(cx - x, cz - z) });
        break;
      }
    }
  }
  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) => (b.d > a.d ? b : a));
  const vx = (cx - best.x) / best.d;
  const vz = (cz - best.z) / best.d;
  const px = -vz; // perpendicular (screen-right-ish)
  const pz = vx;
  // Look slightly past the centre so the far wall is in frame
  const look = (s: number): Vec3 => [cx + vx * best.d * 0.25 + px * s, LOOK_HEIGHT, cz + vz * best.d * 0.25 + pz * s];
  const area = room.area || 10;
  const fov = area < 8 ? 62 : area < 16 ? 56 : 50;

  let from: Pose;
  let to: Pose;
  const slide = Math.min(0.45, best.d * 0.25);
  const slideOk =
    index % 2 === 1 &&
    spotOk(best.x - px * slide, best.z - pz * slide, room, walls, tall) &&
    spotOk(best.x + px * slide, best.z + pz * slide, room, walls, tall);
  if (slideOk) {
    // Lateral slide (truck) with a gentle counter-pan: parallax on the furniture
    from = { pos: [best.x - px * slide, EYE_HEIGHT, best.z - pz * slide], target: look(-slide * 0.4) };
    to = { pos: [best.x + px * slide, EYE_HEIGHT, best.z + pz * slide], target: look(slide * 0.4) };
  } else {
    // Dolly-in toward the centre, lowering slightly
    const push = Math.min(0.9, best.d * 0.3);
    const ex = best.x + vx * push;
    const ez = best.z + vz * push;
    const endOk = spotOk(ex, ez, room, walls, tall);
    from = { pos: [best.x, EYE_HEIGHT + 0.05, best.z], target: look(0.25) };
    to = { pos: endOk ? [ex, EYE_HEIGHT - 0.05, ez] : [best.x, EYE_HEIGHT - 0.05, best.z], target: look(-0.25) };
  }
  return {
    kind: "interior",
    duration: ROOM_S,
    from,
    to,
    fov,
    caption: { title: room.name, subtitle: room.area ? `${Math.round(room.area)} m²` : undefined, style: "lower" },
    roomId: room.id,
  };
}

function aerial(
  center: [number, number],
  radius: [number, number],
  height: [number, number],
  az: [number, number],
  duration: number,
  caption: Caption | null,
): Shot {
  const pose = (r: number, h: number, a: number): Pose => ({
    pos: [center[0] + r * Math.sin(a), h, center[1] + r * Math.cos(a)],
    target: [center[0], 0.3, center[1]],
  });
  return {
    kind: "aerial",
    duration,
    from: pose(radius[0], height[0], az[0]),
    to: pose(radius[1], height[1], az[1]),
    orbit: { center, targetY: 0.3, radius, height, az },
    fov: 38,
    caption,
  };
}

export function planTour(graph: SceneGraph, opts: { title: string; subtitle?: string }): Tour {
  const level = graph.levels[0];
  const b = graph.meta.bounds;
  const center: [number, number] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 4);
  const shots: Shot[] = [];

  shots.push(aerial(center, [extent * 0.95, extent * 0.85], [extent * 0.8, extent * 0.7], [deg(25), deg(70)], AERIAL_S, {
    title: opts.title,
    subtitle: opts.subtitle,
    style: "title",
  }));

  const rooms = (level?.rooms || [])
    .filter((r) => r.polygon.length >= 3 && (r.area || 0) >= MIN_ROOM_AREA && r.type !== "hallway" && r.type !== "balcony")
    .sort((a, c) => (ROOM_ORDER[a.type] ?? 6) - (ROOM_ORDER[c.type] ?? 6) || (c.area || 0) - (a.area || 0))
    .slice(0, MAX_ROOMS);
  rooms.forEach((room) => {
    const shot = interiorShot(room, level?.walls || [], level?.items || [], shots.length);
    if (shot) shots.push(shot);
  });

  shots.push(aerial(center, [extent * 0.7, extent * 1.15], [extent * 0.55, extent * 1.05], [deg(200), deg(235)], OUTRO_S, {
    title: opts.title,
    subtitle: "Made with SoraPlan",
    style: "title",
  }));

  return { shots, duration: shots.reduce((s, x) => s + x.duration, 0) };
}

function poseAt(shot: Shot, u: number): Pose {
  const e = easeInOut(u);
  if (shot.orbit) {
    const o = shot.orbit;
    const r = lerp(o.radius[0], o.radius[1], e);
    const a = lerp(o.az[0], o.az[1], e);
    return {
      pos: [o.center[0] + r * Math.sin(a), lerp(o.height[0], o.height[1], e), o.center[1] + r * Math.cos(a)],
      target: [o.center[0], o.targetY, o.center[1]],
    };
  }
  return { pos: lerp3(shot.from.pos, shot.to.pos, e), target: lerp3(shot.from.target, shot.to.target, e) };
}

export function sampleTour(tour: Tour, t: number): TourFrame {
  const time = Math.min(Math.max(0, t), tour.duration);
  let start = 0;
  let i = 0;
  while (i < tour.shots.length - 1 && time >= start + tour.shots[i].duration) start += tour.shots[i++].duration;
  const shot = tour.shots[i];
  const local = time - start;
  const u = shot.duration > 0 ? local / shot.duration : 1;
  const pose = poseAt(shot, u);

  // Dips to black: longer fade-in at the very start, longer fade-out at the very end
  const fadeIn = i === 0 ? 0.9 : DIP_S;
  const fadeOut = i === tour.shots.length - 1 ? 1.4 : DIP_S;
  const fade = Math.max(1 - local / fadeIn, 1 - (shot.duration - local) / fadeOut, 0);

  // Captions ease in after the cut and leave before the next one
  const captionAlpha = shot.caption ? Math.max(0, Math.min(1, (local - 0.5) / 0.6, (shot.duration - 0.5 - local) / 0.6)) : 0;

  return {
    position: pose.pos,
    target: pose.target,
    fov: shot.fov,
    interior: shot.kind === "interior",
    fade: Math.min(1, fade),
    caption: shot.caption,
    captionAlpha,
    shotIndex: i,
  };
}

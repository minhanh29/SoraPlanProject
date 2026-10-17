// Cinematic house tour: candidate shots from a visibility analysis, a shot list (chosen by Gemini or by the
// automatic default) and sampling at any time t (seconds). Pure (no three.js), so the same plan drives the live
// preview and the frame-exact video export.
//
// Shot grammar (real-estate clip): aerial establishing orbit with the title → interior moves at eye height with
// the room name → aerial pull-back. Shots are joined by short dips to black.
//
// Candidates: for every room, camera spots on a grid inside the room (clear of walls and furniture) × 16 view
// directions, scored by a 2D ray fan across the real 16:9 field of view against walls (doors and open passages
// are see-through) and tall furniture: how much of the room's own furniture is in clear view, how deep the
// frame is, with heavy penalties for staring at a nearby wall or wardrobe. The best few diverse candidates per
// room go to Gemini (with rendered previews), which picks and orders them; the scene code builds the moves.

import type { ItemInstance, SceneGraph, SceneOpening, SceneRoom, SceneWall, Vec3 } from "../../lib/types";
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

/** A scored viewpoint inside one room (the unit Gemini chooses from). */
export interface Candidate {
  id: string;
  roomId: string;
  roomName: string;
  pos: Vec3;
  /** View direction on the floor plane (unit x, z). */
  dir: [number, number];
  fov: number;
  score: number;
  /** Free distance straight ahead (m). */
  depth: number;
  /** Labels of the room's furniture in clear view. */
  visible: string[];
  /** Plain-language summary for the AI director. */
  description: string;
}

export const MOVES = ["dolly_in", "dolly_out", "slide_left", "slide_right", "pan_left", "pan_right", "drift"] as const;
export type Move = (typeof MOVES)[number];

export interface ShotChoice {
  candidateId: string;
  move: Move;
  duration: number;
}

export const EYE_HEIGHT = 1.4;
const LOOK_HEIGHT = 0.95;
const AERIAL_S = 7;
const OUTRO_S = 6;
const DIP_S = 0.3; // half of a dip to black between shots
const MIN_ROOM_AREA = 3; // m²
const MAX_ROOMS = 10;
const WALL_CLEARANCE = 0.35; // camera stays this far from wall faces
const ITEM_CLEARANCE = 0.25; // and from furniture
const BLOCKING_HEIGHT = 1.2; // furniture at least this tall blocks the view at eye height
const RAYS = 17;
const MAX_RAY = 12;
const YAWS = 16;
const PER_ROOM = 4;
const ASPECT = 16 / 9;
export const SHOT_MIN_S = 3.5;
export const SHOT_MAX_S = 7;

/** Rooms in default tour order: living spaces first, then bedrooms, bathrooms last. */
const ROOM_ORDER: Record<string, number> = { living: 0, dining: 1, kitchen: 2, bedroom: 3, office: 4, bathroom: 5, other: 6 };

const deg = (d: number) => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Slow in, slow out: the camera never starts or stops abruptly. */
export const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

/** Horizontal field of view (rad) of a 16:9 frame with vertical fov `vfovDeg`. */
const hfov = (vfovDeg: number) => 2 * Math.atan(Math.tan(deg(vfovDeg) / 2) * ASPECT);
const fovFor = (area: number) => (area < 8 ? 64 : area < 16 ? 58 : 52);

// ---------------------------------------------------------------- 2D visibility

type Seg = [number, number, number, number]; // x1, z1, x2, z2

export function roomCentroid(poly: { x: number; z: number }[]): [number, number] {
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

/** Wall centerlines with doors/open passages cut out (windows stay opaque at eye height). */
function wallSegments(walls: SceneWall[], openings: SceneOpening[]): Seg[] {
  const out: Seg[] = [];
  for (const w of walls) {
    const [x1, z1] = w.start;
    const [x2, z2] = w.end;
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.01) continue;
    const gaps = openings
      .filter((o) => o.wallId === w.id && o.type !== "window")
      .map((o) => [clamp(o.offset - o.width / 2, 0, len), clamp(o.offset + o.width / 2, 0, len)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let u = 0;
    for (const [g0, g1] of [...gaps, [len, len] as [number, number]]) {
      if (g0 - u > 0.01) {
        const a = u / len;
        const b = g0 / len;
        out.push([x1 + (x2 - x1) * a, z1 + (z2 - z1) * a, x1 + (x2 - x1) * b, z1 + (z2 - z1) * b]);
      }
      u = Math.max(u, g1);
    }
  }
  return out;
}

function itemSegments(items: ItemInstance[]): Seg[] {
  const out: Seg[] = [];
  for (const it of items) {
    if (it.dims.h < BLOCKING_HEIGHT) continue;
    const c = footprintCorners(it);
    for (let i = 0; i < 4; i++) out.push([c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1]]);
  }
  return out;
}

/** Distance along the unit ray (px, pz) + t·(dx, dz) to the first obstacle (capped at MAX_RAY). */
function rayDistance(px: number, pz: number, dx: number, dz: number, segs: Seg[]): number {
  let best = MAX_RAY;
  for (const [x1, z1, x2, z2] of segs) {
    const ex = x2 - x1;
    const ez = z2 - z1;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const ox = x1 - px;
    const oz = z1 - pz;
    const t = (ox * ez - oz * ex) / den;
    const u = (ox * dz - oz * dx) / den;
    if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
  }
  return best;
}

function blocked(px: number, pz: number, qx: number, qz: number, segs: Seg[]): boolean {
  const dx = qx - px;
  const dz = qz - pz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  return rayDistance(px, pz, dx / len, dz / len, segs) < len - 0.05;
}

function distToSeg(px: number, pz: number, [x1, z1, x2, z2]: Seg): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - x1) * dx + (pz - z1) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

interface Scene2D {
  walls: SceneWall[];
  wallSegs: Seg[];
  obstacles: Seg[];
  items: ItemInstance[];
  footprints: { x: number; z: number }[][];
  /** Per tall item: walls + every other tall item (its own outline must not hide it). */
  exceptSelf: Map<string, Seg[]>;
}

function scene2d(graph: SceneGraph): Scene2D {
  const level = graph.levels[0];
  const walls = level?.walls || [];
  const items = level?.items || [];
  const wallSegs = wallSegments(walls, level?.openings || []);
  const tall = items.filter((it) => it.dims.h >= BLOCKING_HEIGHT);
  return {
    walls,
    wallSegs,
    exceptSelf: new Map(tall.map((it) => [it.id, [...wallSegs, ...itemSegments(tall.filter((o) => o.id !== it.id))]])),
    obstacles: [...wallSegs, ...itemSegments(items)],
    items,
    footprints: items.map((it) =>
      footprintCorners({ ...it, dims: { ...it.dims, w: it.dims.w + 2 * ITEM_CLEARANCE, d: it.dims.d + 2 * ITEM_CLEARANCE } }).map(([x, z]) => ({ x, z })),
    ),
  };
}

/** A spot where a person could stand with a camera: inside the room, clear of walls and furniture. */
function standable(x: number, z: number, room: SceneRoom, s: Scene2D): boolean {
  if (!pointInPolygon(x, z, room.polygon)) return false;
  for (const w of s.walls) {
    if (distToSeg(x, z, [w.start[0], w.start[1], w.end[0], w.end[1]]) < WALL_CLEARANCE + w.thickness / 2) return false;
  }
  return !s.footprints.some((f) => pointInPolygon(x, z, f));
}

function roomItems(room: SceneRoom, s: Scene2D): ItemInstance[] {
  return s.items.filter((it) => it.roomId === room.id || (!it.roomId && pointInPolygon(it.position[0], it.position[2], room.polygon)));
}

const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
/** Plan compass: x → east, z (plan y, down) → south. */
const heading = (dx: number, dz: number) => COMPASS[(Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) + 8) % 8];

function evaluate(room: SceneRoom, own: ItemInstance[], x: number, z: number, dx: number, dz: number, fov: number, s: Scene2D) {
  const half = hfov(fov) / 2;
  const base = Math.atan2(dz, dx);
  const depths: number[] = [];
  for (let i = 0; i < RAYS; i++) {
    const a = base - half + (2 * half * i) / (RAYS - 1);
    depths.push(rayDistance(x, z, Math.cos(a), Math.sin(a), s.obstacles));
  }
  const mid = depths.slice(Math.floor(RAYS / 3), Math.ceil((2 * RAYS) / 3));
  const center = [...mid].sort((a, b) => a - b)[Math.floor(mid.length / 2)];
  const nearest = Math.min(...mid);
  // A ray that hits nothing has left the home (gaps in the parsed walls): the frame shows empty background
  const escaped = (d: number) => d >= MAX_RAY - 0.01;
  const openness = depths.reduce((t, d) => t + (escaped(d) ? 0 : Math.min(d, 8)), 0) / (depths.length * 8);
  const voidFrac = depths.filter(escaped).length / depths.length;
  // Furniture of any height right in front of the lens fills the frame (kitchen island, bed end)
  const inFace = s.items.some((it) => {
    if (it.dims.h < 0.6) return false;
    const ix = it.position[0] - x;
    const iz = it.position[2] - z;
    const reach = Math.hypot(ix, iz) - Math.min(it.dims.w, it.dims.d) / 2;
    if (reach > 1.2) return false;
    let ang = Math.atan2(iz, ix) - base;
    ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    return Math.abs(ang) < half * 0.6;
  });
  const visible = own.filter((it) => {
    const ix = it.position[0] - x;
    const iz = it.position[2] - z;
    const dist = Math.hypot(ix, iz);
    if (dist < 0.9 || dist > MAX_RAY) return false;
    let ang = Math.atan2(iz, ix) - base;
    ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    if (Math.abs(ang) > half * 0.88) return false;
    // A tall item's own outline must not hide it: test against walls and other tall furniture only
    return !blocked(x, z, it.position[0], it.position[2], s.exceptSelf.get(it.id) ?? s.obstacles);
  });
  const itemFrac = own.length ? visible.length / own.length : openness;
  let score = 2.4 * itemFrac + 1.0 * openness + 0.5 * (escaped(center) ? 0 : Math.min(center, 6) / 6);
  if (center < 1.8) score -= 1.6; // staring at a wall / wardrobe
  if (nearest < 1.0) score -= 1.0; // something right in the lens
  if (inFace) score -= 0.8;
  score -= 1.6 * voidFrac;
  // Real-estate framing: back to a wall, looking into the room
  const behind = rayDistance(x, z, -dx, -dz, s.obstacles);
  if (behind < 1.3) score += 0.25;
  if (!own.length && room.area && room.area < 6) score -= 0.2;
  return { score, depth: center, visible };
}

/** Scored, diverse candidate viewpoints for every eligible room (best first within each room). */
export function shotCandidates(graph: SceneGraph): Candidate[] {
  const level = graph.levels[0];
  if (!level) return [];
  const s = scene2d(graph);
  const rooms = level.rooms.filter((r) => r.polygon.length >= 3 && (r.area || 0) >= MIN_ROOM_AREA && r.type !== "balcony");
  const out: Candidate[] = [];
  for (const room of rooms) {
    const own = roomItems(room, s);
    const xs = room.polygon.map((p) => p.x);
    const zs = room.polygon.map((p) => p.z);
    const area = room.area || (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    const step = Math.max(0.4, Math.sqrt(area / 70));
    const fov = fovFor(area);
    const scored: Omit<Candidate, "id" | "description">[] = [];
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
      for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
        if (!standable(x, z, room, s)) continue;
        for (let k = 0; k < YAWS; k++) {
          const a = (2 * Math.PI * k) / YAWS;
          const dx = Math.cos(a);
          const dz = Math.sin(a);
          const e = evaluate(room, own, x, z, dx, dz, fov, s);
          scored.push({
            roomId: room.id,
            roomName: room.name,
            pos: [x, EYE_HEIGHT, z],
            dir: [dx, dz],
            fov,
            score: e.score,
            depth: e.depth,
            visible: e.visible.map((it) => it.label || it.category || "item"),
          });
        }
      }
    scored.sort((a, b) => b.score - a.score);
    // Diversity: different spots or clearly different directions
    const picked: typeof scored = [];
    for (const c of scored) {
      if (picked.length >= PER_ROOM) break;
      const close = picked.some(
        (p) => Math.hypot(p.pos[0] - c.pos[0], p.pos[2] - c.pos[2]) < 1.2 && p.dir[0] * c.dir[0] + p.dir[1] * c.dir[1] > Math.cos(deg(50)),
      );
      if (!close) picked.push(c);
    }
    const [cx, cz] = roomCentroid(room.polygon);
    picked.forEach((c, i) => {
      const where = heading(c.pos[0] - cx, c.pos[2] - cz);
      const sees = c.visible.length ? `In view: ${[...new Set(c.visible)].slice(0, 8).join(", ")} (${c.visible.length}/${own.length} of the room's items)` : "No furniture in view";
      out.push({
        ...c,
        id: `${room.id}#${i + 1}`,
        description: `${room.name}: camera on the ${where} side, looking ${heading(c.dir[0], c.dir[1])}. ${sees}. ${
          c.depth >= MAX_RAY - 0.01 ? "Looks out through a gap in the walls." : `Clear depth ahead ${c.depth.toFixed(1)} m.`
        }`,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------- shots

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

/**
 * Turn a candidate + move into a camera path. Every end point is re-checked (standable, still not facing a
 * wall); a move that does not fit falls back to a shorter one, then to a gentle drift.
 */
function interiorShot(c: Candidate, move: Move, duration: number, room: SceneRoom, s: Scene2D): Shot {
  const [dx, dz] = c.dir;
  const [rx, rz] = [-dz, dx]; // screen-right on the floor
  const [x, , z] = c.pos;
  const look = (px: number, pz: number, ddx: number, ddz: number): Vec3 => {
    const d = clamp(rayDistance(px, pz, ddx, ddz, s.obstacles) * 0.6, 1.5, 4);
    return [px + ddx * d, LOOK_HEIGHT, pz + ddz * d];
  };
  const ok = (px: number, pz: number) => standable(px, pz, room, s) && rayDistance(px, pz, dx, dz, s.obstacles) > 1.4;
  const at = (px: number, pz: number, ddx = dx, ddz = dz): Pose => ({ pos: [px, EYE_HEIGHT, pz], target: look(px, pz, ddx, ddz) });

  const tryOffset = (ox: number, oz: number, max: number): number => {
    for (let d = max; d >= 0.2; d -= 0.1) if (ok(x + ox * d, z + oz * d)) return d;
    return 0;
  };
  let from = at(x, z);
  let to = from;
  const kind = move;
  if (kind === "dolly_in" || kind === "dolly_out") {
    const d = tryOffset(dx, dz, Math.min(0.9, c.depth - 1.6));
    const near = at(x + dx * d, z + dz * d);
    [from, to] = kind === "dolly_in" ? [at(x, z), near] : [near, at(x, z)];
    if (d === 0) to = at(x + dx * 0.12, z + dz * 0.12);
  } else if (kind === "slide_left" || kind === "slide_right") {
    const sgn = kind === "slide_right" ? 1 : -1;
    const d = tryOffset(rx * sgn, rz * sgn, 0.7);
    if (d > 0) {
      // Truck along the line of view with a slight counter-pan: parallax on the furniture
      from = at(x, z);
      const ex = x + rx * sgn * d;
      const ez = z + rz * sgn * d;
      to = { pos: [ex, EYE_HEIGHT, ez], target: [from.target[0] + rx * sgn * d * 0.6, LOOK_HEIGHT, from.target[2] + rz * sgn * d * 0.6] };
    } else to = at(x + dx * 0.12, z + dz * 0.12);
  } else if (kind === "pan_left" || kind === "pan_right") {
    const sgn = kind === "pan_right" ? 1 : -1;
    const a = Math.atan2(dz, dx);
    const turn = deg(14) * sgn;
    const [d0x, d0z] = [Math.cos(a - turn / 2), Math.sin(a - turn / 2)];
    const [d1x, d1z] = [Math.cos(a + turn / 2), Math.sin(a + turn / 2)];
    from = at(x, z, d0x, d0z);
    to = at(x, z, d1x, d1z);
  } else {
    to = at(x + dx * 0.15, z + dz * 0.15);
  }
  return {
    kind: "interior",
    duration: clamp(duration, SHOT_MIN_S, SHOT_MAX_S),
    from,
    to,
    fov: c.fov,
    caption: { title: c.roomName, style: "lower" },
    roomId: c.roomId,
  };
}

/** Automatic shot list: the best candidate of each room, living spaces first, alternating moves. */
export function defaultChoices(graph: SceneGraph, candidates: Candidate[]): ShotChoice[] {
  const rooms = new Map((graph.levels[0]?.rooms || []).map((r) => [r.id, r]));
  const best = new Map<string, Candidate>();
  for (const c of candidates) if (!best.has(c.roomId) || c.score > best.get(c.roomId)!.score) best.set(c.roomId, c);
  const order = [...best.values()]
    .filter((c) => c.score > 0.6 && rooms.get(c.roomId)?.type !== "hallway") // nothing worth showing / corridors
    .sort((a, b) => {
      const ra = rooms.get(a.roomId);
      const rb = rooms.get(b.roomId);
      return (ROOM_ORDER[ra?.type || "other"] ?? 6) - (ROOM_ORDER[rb?.type || "other"] ?? 6) || (rb?.area || 0) - (ra?.area || 0);
    })
    .slice(0, MAX_ROOMS);
  const moves: Move[] = ["dolly_in", "slide_right", "dolly_in", "slide_left"];
  return order.map((c, i) => ({ candidateId: c.id, move: moves[i % moves.length], duration: 5 }));
}

/** Assemble the tour: aerial title → chosen interior shots → aerial outro. Unknown candidate ids are skipped. */
export function buildTour(graph: SceneGraph, candidates: Candidate[], choices: ShotChoice[], opts: { title: string; subtitle?: string }): Tour {
  const level = graph.levels[0];
  const b = graph.meta.bounds;
  const center: [number, number] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 4);
  const s = scene2d(graph);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const rooms = new Map((level?.rooms || []).map((r) => [r.id, r]));
  const shots: Shot[] = [];

  shots.push(aerial(center, [extent * 0.95, extent * 0.85], [extent * 0.8, extent * 0.7], [deg(25), deg(70)], AERIAL_S, {
    title: opts.title,
    subtitle: opts.subtitle,
    style: "title",
  }));
  let lastRoom: string | null = null;
  for (const ch of choices) {
    const c = byId.get(ch.candidateId);
    const room = c && rooms.get(c.roomId);
    if (!c || !room) continue;
    const shot = interiorShot(c, (MOVES as readonly string[]).includes(ch.move) ? ch.move : "drift", ch.duration, room, s);
    if (c.roomId === lastRoom) shot.caption = null; // second angle of the same room: the name is already shown
    lastRoom = c.roomId;
    shots.push(shot);
  }
  shots.push(aerial(center, [extent * 0.7, extent * 1.15], [extent * 0.55, extent * 1.05], [deg(200), deg(235)], OUTRO_S, {
    title: opts.title,
    subtitle: "Made with SoraPlan",
    style: "title",
  }));
  return { shots, duration: shots.reduce((t, x) => t + x.duration, 0) };
}

/** Automatic tour (no AI): candidates + default choices. */
export function planTour(graph: SceneGraph, opts: { title: string; subtitle?: string }): Tour {
  const candidates = shotCandidates(graph);
  return buildTour(graph, candidates, defaultChoices(graph, candidates), opts);
}

/** Pairs of rooms joined by a door or open passage (for the AI director's walkthrough order). */
export function roomConnections(graph: SceneGraph): Record<string, string[]> {
  const level = graph.levels[0];
  const out: Record<string, Set<string>> = {};
  if (!level) return {};
  for (const o of level.openings) {
    if (o.type === "window") continue;
    const w = level.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const [x1, z1] = w.start;
    const [x2, z2] = w.end;
    const len = Math.hypot(x2 - x1, z2 - z1) || 1;
    const ux = (x2 - x1) / len;
    const uz = (z2 - z1) / len;
    const mx = x1 + ux * o.offset;
    const mz = z1 + uz * o.offset;
    const side = (sgn: number) => level.rooms.find((r) => pointInPolygon(mx - uz * sgn * 0.5, mz + ux * sgn * 0.5, r.polygon))?.id;
    const a = side(1);
    const c = side(-1);
    if (a && c && a !== c) {
      (out[a] ||= new Set()).add(c);
      (out[c] ||= new Set()).add(a);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

// ---------------------------------------------------------------- sampling

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

/** The opening pose of a candidate (for its preview still). */
export function candidatePose(c: Candidate): { position: Vec3; target: Vec3; fov: number } {
  return {
    position: c.pos,
    target: [c.pos[0] + c.dir[0] * Math.min(Math.max(c.depth * 0.6, 1.5), 4), LOOK_HEIGHT, c.pos[2] + c.dir[1] * Math.min(Math.max(c.depth * 0.6, 1.5), 4)],
    fov: c.fov,
  };
}

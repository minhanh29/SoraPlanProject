// Canvas 2D rendering of the plan editor. Pure drawing: everything comes in through DrawState.
import type { PlanRoom, PlanUnits } from "../../lib/types";
import { cssVar } from "../../lib/theme";
import { isWall, unitSymbol, type BoxObj, type EditorObject, type WallObj } from "./model";
import { ROTATE_STEM, type LayerVisibility } from "./hitTest";
import { scaleOf, toScreen, type View } from "./view";
import type { Drag } from "./interactions";

export interface Palette {
  bg: string;
  grid: string;
  wall: string;
  room: string;
  roomLabel: string;
  furniture: string;
  furnitureStroke: string;
  fixture: string;
  fixtureStroke: string;
  select: string;
  missing: string;
  dim: string;
  text: string;
  textInverse: string;
  muted: string;
  surface: string;
  success: string;
  font: string;
  mono: string;
}

export function readPalette(): Palette {
  return {
    bg: cssVar("--plan-bg", "#fff"),
    grid: cssVar("--plan-grid", "#eee"),
    wall: cssVar("--plan-wall", "#222"),
    room: cssVar("--plan-room", "rgba(0,0,0,0.04)"),
    roomLabel: cssVar("--plan-room-label", "#36c"),
    furniture: cssVar("--plan-furniture", "#dbe4ff"),
    furnitureStroke: cssVar("--plan-furniture-stroke", "#4263eb"),
    fixture: cssVar("--plan-fixture", "#d3f9d8"),
    fixtureStroke: cssVar("--plan-fixture-stroke", "#2b8a3e"),
    select: cssVar("--plan-select", "#7048e8"),
    missing: cssVar("--plan-missing", "#f59f00"),
    dim: cssVar("--plan-dim", "#7048e8"),
    text: cssVar("--text", "#111"),
    textInverse: cssVar("--bg", "#fff"),
    muted: cssVar("--text-3", "#888"),
    surface: cssVar("--surface", "#fff"),
    success: cssVar("--success", "#1f9d55"),
    font: cssVar("--font", "Inter, sans-serif"),
    mono: cssVar("--mono", "monospace"),
  };
}

/** Per-box decoration in mapping mode. Footprint sizes are in plan units; rotation in plan degrees. */
export interface Decoration {
  kind: "matched" | "missing" | "skipped" | "generating" | "failed";
  image?: HTMLImageElement | null;
  footprint?: { w: number; d: number; rotation: number } | null;
  progress?: number;
  stretched?: boolean;
}

export interface DrawState {
  view: View;
  width: number; // css px
  height: number;
  plan: {
    width: number;
    height: number;
    units: PlanUnits;
    rooms: PlanRoom[];
    sourceImage?: { cropX?: number | null; cropY?: number | null; cropWidth?: number | null; cropHeight?: number | null } | null;
  };
  objects: EditorObject[];
  selectedId: string | null;
  hoverId: string | null;
  layers: LayerVisibility;
  overlay: { img: HTMLImageElement; opacity: number } | null;
  palette: Palette;
  mode: "edit" | "mapping";
  decorations?: Record<string, Decoration>;
  pulse: number; // 0..1 animation phase for missing boxes
  drag: Drag | null;
  addRect?: { x: number; y: number; w: number; h: number } | null;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, Math.min(w, h) / 2)));
}

function gridStep(k: number): number {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50]) if (s * k >= 14) return s;
  return 100;
}

export function drawPlan(ctx: CanvasRenderingContext2D, st: DrawState) {
  const { view, palette: p, plan } = st;
  const k = scaleOf(view);
  ctx.save();
  ctx.clearRect(0, 0, st.width, st.height);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, st.width, st.height);

  const tl = toScreen(view, 0, 0);
  const pw = plan.width * k;
  const ph = plan.height * k;

  // 1. Grid
  if (st.layers.grid) {
    const step = gridStep(k);
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= plan.width + 1e-6; x += step) {
      const sx = Math.round(tl.x + x * k) + 0.5;
      ctx.moveTo(sx, tl.y);
      ctx.lineTo(sx, tl.y + ph);
    }
    for (let y = 0; y <= plan.height + 1e-6; y += step) {
      const sy = Math.round(tl.y + y * k) + 0.5;
      ctx.moveTo(tl.x, sy);
      ctx.lineTo(tl.x + pw, sy);
    }
    ctx.stroke();
  }

  // 2. Reference image
  if (st.layers.overlay && st.overlay && st.overlay.opacity > 0) {
    const { img, opacity } = st.overlay;
    const src = plan.sourceImage;
    ctx.save();
    ctx.globalAlpha = opacity;
    if (src && src.cropWidth && src.cropHeight && src.cropWidth > 0 && src.cropHeight > 0) {
      ctx.drawImage(img, src.cropX || 0, src.cropY || 0, src.cropWidth, src.cropHeight, tl.x, tl.y, pw, ph);
    } else {
      ctx.drawImage(img, tl.x, tl.y, pw, ph);
    }
    ctx.restore();
  }

  // Plan boundary
  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tl.x, tl.y, pw, ph);

  // 3. Rooms
  if (st.layers.room) {
    for (const r of plan.rooms || []) {
      if (!r.polygon || r.polygon.length < 3) continue;
      ctx.beginPath();
      r.polygon.forEach((pt, i) => {
        const s = toScreen(view, pt.x, pt.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fillStyle = p.room;
      ctx.fill();
      if (st.layers.labels && r.name) {
        const c = r.labelPosition || centroid(r.polygon);
        const s = toScreen(view, c.x, c.y);
        ctx.fillStyle = p.roomLabel;
        ctx.font = `600 11px ${p.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = 0.85;
        ctx.fillText(r.name.toUpperCase(), s.x, s.y);
        ctx.globalAlpha = 1;
      }
    }
  }

  // 4. Walls, then boxes
  if (st.layers.wall) for (const o of st.objects) if (isWall(o)) drawWall(ctx, o, st);
  for (const o of st.objects) {
    if (isWall(o) || !st.layers[o.type]) continue;
    if (st.mode === "mapping") drawMappedBox(ctx, o, st);
    else drawBox(ctx, o, st);
  }

  // 5. Overall dimensions
  drawDimensions(ctx, st);

  // 6. Selection
  const sel = st.selectedId ? st.objects.find((o) => o.id === st.selectedId) : null;
  if (sel) {
    if (isWall(sel)) drawWallSelection(ctx, sel, st);
    else if (st.mode === "mapping") drawFootprintSelection(ctx, sel, st);
    else drawBoxSelection(ctx, sel, st);
  }

  // 7. Add-box rubber band
  if (st.addRect) {
    const a = toScreen(view, st.addRect.x, st.addRect.y);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = p.select;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = p.furniture;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(a.x, a.y, st.addRect.w * k, st.addRect.h * k);
    ctx.globalAlpha = 1;
    ctx.strokeRect(a.x, a.y, st.addRect.w * k, st.addRect.h * k);
    ctx.setLineDash([]);
    badge(ctx, st, `${st.addRect.w.toFixed(1)} × ${st.addRect.h.toFixed(1)}${unitSymbol(plan.units)}`, a.x + (st.addRect.w * k) / 2, a.y + st.addRect.h * k + 8);
    ctx.restore();
  }
  ctx.restore();
}

function centroid(poly: { x: number; y: number }[]) {
  let x = 0;
  let y = 0;
  for (const pt of poly) {
    x += pt.x;
    y += pt.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

function drawWall(ctx: CanvasRenderingContext2D, w: WallObj, st: DrawState) {
  const k = scaleOf(st.view);
  const a = toScreen(st.view, w.x1, w.y1);
  const b = toScreen(st.view, w.x2, w.y2);
  const sel = st.selectedId === w.id;
  ctx.save();
  ctx.lineCap = "square";
  ctx.strokeStyle = sel ? st.palette.select : st.palette.wall;
  ctx.globalAlpha = st.mode === "mapping" ? 0.75 : w.exterior ? 1 : 0.88;
  ctx.lineWidth = Math.max(2.5, (w.thickness || 0.5) * k) + (sel ? 2 : 0);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function boxKind(o: BoxObj): "closet" | "bed" | "sofa" | "table" | "bath" | "toilet" | "sink" | "other" {
  const t = `${o.subtype} ${o.category || ""} ${o.name}`.toLowerCase();
  if (/wardrobe|closet|storage|cabinet|dresser|cupboard/.test(t)) return "closet";
  if (/\bbeds?\b/.test(t)) return "bed";
  if (/sofa|couch/.test(t)) return "sofa";
  if (/bath ?tub|bathtub|\bbath\b/.test(t)) return "bath";
  if (/toilet|\bwc\b/.test(t)) return "toilet";
  if (/sink|vanity/.test(t)) return "sink";
  if (/table|desk|island|counter/.test(t)) return "table";
  return "other";
}

function boxFrame(ctx: CanvasRenderingContext2D, o: BoxObj, st: DrawState) {
  const k = scaleOf(st.view);
  const c = toScreen(st.view, o.x + o.w / 2, o.y + o.h / 2);
  ctx.translate(c.x, c.y);
  ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
  return { w: o.w * k, h: o.h * k };
}

function drawAccents(ctx: CanvasRenderingContext2D, o: BoxObj, w: number, h: number) {
  const kind = boxKind(o);
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.45;
  if (kind === "closet") {
    const n = 3;
    const vertical = h >= w;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      if (vertical) {
        const y = -h / 2 + (h * i) / n;
        ctx.moveTo(-w / 2 + 3, y);
        ctx.lineTo(w / 2 - 3, y);
      } else {
        const x = -w / 2 + (w * i) / n;
        ctx.moveTo(x, -h / 2 + 3);
        ctx.lineTo(x, h / 2 - 3);
      }
    }
    ctx.stroke();
  } else if (kind === "bed") {
    ctx.strokeRect(-w / 2 + w * 0.12, -h / 2 + h * 0.07, w * 0.32, h * 0.15);
    ctx.strokeRect(w / 2 - w * 0.44, -h / 2 + h * 0.07, w * 0.32, h * 0.15);
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 + h * 0.3);
    ctx.lineTo(w / 2, -h / 2 + h * 0.3);
    ctx.stroke();
  } else if (kind === "sofa") {
    ctx.strokeRect(-w / 2 + w * 0.06, -h / 2 + h * 0.06, w * 0.88, h * 0.26);
    ctx.strokeRect(-w / 2 + w * 0.06, -h / 2 + h * 0.06, w * 0.12, h * 0.88);
    ctx.strokeRect(w / 2 - w * 0.18, -h / 2 + h * 0.06, w * 0.12, h * 0.88);
  } else if (kind === "bath") {
    rr(ctx, -w / 2 + w * 0.08, -h / 2 + h * 0.1, w * 0.84, h * 0.8, Math.min(w, h) / 3);
    ctx.stroke();
  } else if (kind === "toilet") {
    ctx.strokeRect(-w / 2 + w * 0.15, -h / 2 + h * 0.08, w * 0.7, h * 0.25);
    ctx.beginPath();
    ctx.ellipse(0, h * 0.12, w * 0.3, h * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === "sink") {
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.32, h * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === "table") {
    ctx.strokeRect(-w / 2 + w * 0.12, -h / 2 + h * 0.12, w * 0.76, h * 0.76);
  }
  ctx.globalAlpha = 1;
}

function label(ctx: CanvasRenderingContext2D, st: DrawState, text: string, w: number, h: number, color: string) {
  if (!st.layers.labels || w < 30 || h < 16) return;
  const fs = Math.max(9, Math.min(13, Math.min(w / 7, h / 2.6)));
  ctx.font = `600 ${fs}px ${st.palette.font}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0, Math.max(20, w - 8));
}

function drawBox(ctx: CanvasRenderingContext2D, o: BoxObj, st: DrawState) {
  const p = st.palette;
  const fixture = o.type === "fixture";
  const fill = fixture ? p.fixture : p.furniture;
  const stroke = fixture ? p.fixtureStroke : p.furnitureStroke;
  const hover = st.hoverId === o.id && st.selectedId !== o.id;
  ctx.save();
  const { w, h } = boxFrame(ctx, o, st);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = hover ? 2 : 1.2;
  rr(ctx, -w / 2, -h / 2, w, h, Math.min(5, Math.min(w, h) / 6));
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = stroke;
  drawAccents(ctx, o, w, h);
  if (o.addedBy === "user") {
    ctx.fillStyle = p.select;
    ctx.beginPath();
    ctx.arc(w / 2 - 6, -h / 2 + 6, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  label(ctx, st, o.name, w, h, stroke);
  ctx.restore();
}

function drawMappedBox(ctx: CanvasRenderingContext2D, o: BoxObj, st: DrawState) {
  const p = st.palette;
  const dec = st.decorations?.[o.id];
  const k = scaleOf(st.view);
  ctx.save();
  const { w, h } = boxFrame(ctx, o, st);
  const kind = dec?.kind || "missing";

  if (kind === "skipped") {
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = p.muted;
    ctx.lineWidth = 1.2;
    rr(ctx, -w / 2, -h / 2, w, h, 4);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, st, `${o.name} · skipped`, w, h, p.muted);
    ctx.restore();
    return;
  }

  if (kind === "missing" || kind === "failed") {
    const a = 0.35 + 0.65 * st.pulse;
    ctx.fillStyle = p.missing;
    ctx.globalAlpha = 0.1 + 0.1 * st.pulse;
    rr(ctx, -w / 2, -h / 2, w, h, 5);
    ctx.fill();
    ctx.globalAlpha = a;
    ctx.strokeStyle = p.missing;
    ctx.lineWidth = 2 + 2 * st.pulse;
    ctx.stroke();
    ctx.globalAlpha = 1;
    label(ctx, st, o.name, w, h, p.missing);
    ctx.restore();
    return;
  }

  // matched / generating: faint box, thumbnail, real footprint
  ctx.fillStyle = p.surface;
  ctx.globalAlpha = 0.85;
  rr(ctx, -w / 2, -h / 2, w, h, 5);
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = p.furnitureStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  if (dec?.image && dec.image.complete && dec.image.naturalWidth > 0) {
    const img = dec.image;
    const s = Math.min((w - 6) / img.naturalWidth, (h - 6) / img.naturalHeight);
    if (s > 0) {
      ctx.globalAlpha = kind === "generating" ? 0.4 : 0.95;
      ctx.drawImage(img, (-img.naturalWidth * s) / 2, (-img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
      ctx.globalAlpha = 1;
    }
  }
  if (kind === "generating") {
    const fs = Math.max(9, Math.min(12, w / 6));
    ctx.font = `600 ${fs}px ${p.font}`;
    ctx.fillStyle = p.furnitureStroke;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`3D ${Math.round(dec?.progress || 0)}%`, 0, 0, w - 4);
  }
  ctx.restore();

  // Footprint of the scaled model (own rotation)
  if (dec?.footprint) {
    const c = toScreen(st.view, o.x + o.w / 2, o.y + o.h / 2);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((dec.footprint.rotation * Math.PI) / 180);
    const fw = dec.footprint.w * k;
    const fd = dec.footprint.d * k;
    ctx.strokeStyle = dec.stretched ? p.missing : p.furnitureStroke;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(-fw / 2, -fd / 2, fw, fd);
    // front edge marker (model faces local +Z = +y in plan before rotation)
    ctx.beginPath();
    ctx.moveTo(-fw / 4, fd / 2);
    ctx.lineTo(fw / 4, fd / 2);
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.restore();
  }
}

function drawDimensions(ctx: CanvasRenderingContext2D, st: DrawState) {
  const { view, plan, palette: p } = st;
  const a = toScreen(view, 0, 0);
  const b = toScreen(view, plan.width, 0);
  const c = toScreen(view, 0, plan.height);
  const sym = unitSymbol(plan.units);
  ctx.save();
  ctx.strokeStyle = p.dim;
  ctx.fillStyle = p.dim;
  ctx.lineWidth = 1;
  ctx.font = `500 11px ${p.mono}`;
  const ty = a.y - 14;
  ctx.beginPath();
  ctx.moveTo(a.x, ty);
  ctx.lineTo(b.x, ty);
  ctx.moveTo(a.x, ty - 4);
  ctx.lineTo(a.x, ty + 4);
  ctx.moveTo(b.x, ty - 4);
  ctx.lineTo(b.x, ty + 4);
  const lx = a.x - 14;
  ctx.moveTo(lx, a.y);
  ctx.lineTo(lx, c.y);
  ctx.moveTo(lx - 4, a.y);
  ctx.lineTo(lx + 4, a.y);
  ctx.moveTo(lx - 4, c.y);
  ctx.lineTo(lx + 4, c.y);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${plan.width.toFixed(1)}${sym}`, (a.x + b.x) / 2, ty - 3);
  ctx.translate(lx - 5, (a.y + c.y) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${plan.height.toFixed(1)}${sym}`, 0, 0);
  ctx.restore();
}

/** Dark pill with text centered at (x, top). */
function badge(ctx: CanvasRenderingContext2D, st: DrawState, text: string, x: number, top: number, tone?: string) {
  ctx.save();
  ctx.font = `600 11px ${st.palette.font}`;
  const tw = ctx.measureText(text).width + 16;
  const th = 20;
  ctx.fillStyle = tone || st.palette.text;
  ctx.globalAlpha = 0.92;
  rr(ctx, x - tw / 2, top, tw, th, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = st.palette.textInverse;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, top + th / 2);
  ctx.restore();
}

function drawWallSelection(ctx: CanvasRenderingContext2D, o: WallObj, st: DrawState) {
  const p = st.palette;
  const a = toScreen(st.view, o.x1, o.y1);
  const b = toScreen(st.view, o.x2, o.y2);
  ctx.save();
  ctx.strokeStyle = p.select;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (st.mode === "edit") {
    for (const pt of [a, b]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = p.surface;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  ctx.restore();
  const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
  badge(ctx, st, `${len.toFixed(1)}${unitSymbol(st.plan.units)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 10, p.select);
}

function handlesFor(
  ctx: CanvasRenderingContext2D,
  st: DrawState,
  bw: number,
  bh: number,
  opts: { rotate: boolean; activeHandle: string | null },
) {
  const p = st.palette;
  const bx = -bw / 2;
  const by = -bh / 2;
  ctx.strokeStyle = p.select;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.setLineDash([]);
  if (opts.rotate) {
    const ry = by - ROTATE_STEM;
    ctx.beginPath();
    ctx.moveTo(0, by);
    ctx.lineTo(0, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, ry, opts.activeHandle === "rotate" ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = p.select;
    ctx.fill();
    ctx.strokeStyle = p.surface;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, ry, 3.6, -Math.PI * 0.7, Math.PI * 0.7);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  const corners: [string, number, number][] = [
    ["resize-tl", bx, by],
    ["resize-tr", bx + bw, by],
    ["resize-br", bx + bw, by + bh],
    ["resize-bl", bx, by + bh],
  ];
  for (const [name, x, y] of corners) {
    const active = opts.activeHandle === name;
    const sz = active ? 11 : 8;
    rr(ctx, x - sz / 2, y - sz / 2, sz, sz, 2);
    ctx.fillStyle = active ? p.select : p.surface;
    ctx.fill();
    ctx.strokeStyle = active ? p.surface : p.select;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  const edges: [string, number, number, number, number][] = [
    ...(bh >= 18
      ? ([
          ["resize-t", 0, by, 12, 5],
          ["resize-b", 0, by + bh, 12, 5],
        ] as [string, number, number, number, number][])
      : []),
    ["resize-l", bx, 0, 5, Math.min(12, Math.max(6, bh - 4))],
    ["resize-r", bx + bw, 0, 5, Math.min(12, Math.max(6, bh - 4))],
  ];
  for (const [name, x, y, w, h] of edges) {
    const active = opts.activeHandle === name;
    rr(ctx, x - w / 2, y - h / 2, w, h, 2);
    ctx.fillStyle = active ? p.select : p.surface;
    ctx.fill();
    ctx.strokeStyle = active ? p.surface : p.select;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function activeHandle(st: DrawState, id: string): string | null {
  const d = st.drag;
  if (!d || !("id" in d) || d.id !== id) return null;
  if (d.mode === "resize" || d.mode === "footprint") return d.handle;
  if (d.mode === "rotate") return "rotate";
  return null;
}

function drawBoxSelection(ctx: CanvasRenderingContext2D, o: BoxObj, st: DrawState) {
  const k = scaleOf(st.view);
  const c = toScreen(st.view, o.x + o.w / 2, o.y + o.h / 2);
  const bw = o.w * k + 4;
  const bh = o.h * k + 4;
  const act = activeHandle(st, o.id);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
  handlesFor(ctx, st, bw, bh, { rotate: true, activeHandle: act });
  ctx.restore();
  const sym = unitSymbol(st.plan.units);
  const rot = Math.round(o.rotation || 0);
  const text = act === "rotate" ? `${rot}°` : `${o.w.toFixed(1)} × ${o.h.toFixed(1)}${sym} · ${rot}°`;
  const extent = Math.max(bw, bh) / 2;
  badge(ctx, st, text, c.x, c.y + extent + 10, act ? st.palette.select : undefined);
}

function drawFootprintSelection(ctx: CanvasRenderingContext2D, o: BoxObj, st: DrawState) {
  const dec = st.decorations?.[o.id];
  const k = scaleOf(st.view);
  const c = toScreen(st.view, o.x + o.w / 2, o.y + o.h / 2);
  if (!dec?.footprint || dec.kind !== "matched") {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
    ctx.strokeStyle = st.palette.select;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect((-o.w * k) / 2 - 2, (-o.h * k) / 2 - 2, o.w * k + 4, o.h * k + 4);
    ctx.restore();
    return;
  }
  const fw = dec.footprint.w * k;
  const fd = dec.footprint.d * k;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate((dec.footprint.rotation * Math.PI) / 180);
  handlesFor(ctx, st, fw + 4, fd + 4, { rotate: false, activeHandle: activeHandle(st, o.id) });
  ctx.restore();
}

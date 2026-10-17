// Real-world sizing of catalog models (mirror of backend asset_mapper.real_dims; keep the tables in sync).
// Catalog dims are proportions only (longest side ~1.9 units), so an item added without a plan box gets a
// typical length for its category and a height pulled into the category's plausible range.
import type { Dims } from "./types";

/** (min, typical, max) height in meters. */
export const CATEGORY_HEIGHT_RANGE_M: Record<string, [number, number, number]> = {
  Sofa: [0.7, 0.85, 1.0],
  Armchair: [0.7, 0.9, 1.15],
  "Coffee Table": [0.3, 0.45, 0.55],
  "TV Stand": [0.35, 0.55, 0.8],
  "Dining Table": [0.7, 0.75, 0.8],
  "Dining Chair": [0.75, 0.9, 1.05],
  "Dining Bench": [0.4, 0.45, 0.55],
  Stool: [0.45, 0.65, 0.8],
  Bed: [0.45, 0.9, 1.3],
  Nightstand: [0.45, 0.55, 0.7],
  "Wardrobe & Storage": [0.8, 2.0, 2.4],
  "Kitchen Counter": [0.85, 0.9, 2.3],
  "Kitchen Sink": [0.85, 0.9, 1.0],
  "Kitchen Appliance": [0.8, 1.8, 2.0],
  Appliance: [0.8, 0.85, 1.1],
  Bathtub: [0.4, 0.55, 0.7],
  Toilet: [0.65, 0.75, 0.85],
  "Bathroom Vanity": [0.8, 0.85, 0.95],
  Sink: [0.8, 0.85, 1.0],
  Lighting: [0.4, 1.6, 2.0],
  Other: [0.3, 0.8, 2.4],
};

/** Typical longest footprint side in meters. */
export const CATEGORY_LENGTH_M: Record<string, number> = {
  Sofa: 2.1,
  Armchair: 0.85,
  "Coffee Table": 1.1,
  "TV Stand": 1.6,
  "Dining Table": 1.6,
  "Dining Chair": 0.5,
  "Dining Bench": 1.4,
  Stool: 0.45,
  Bed: 2.1,
  Nightstand: 0.5,
  "Wardrobe & Storage": 1.6,
  "Kitchen Counter": 2.0,
  "Kitchen Sink": 1.0,
  "Kitchen Appliance": 0.75,
  Appliance: 0.65,
  Bathtub: 1.7,
  Toilet: 0.7,
  "Bathroom Vanity": 0.9,
  Sink: 0.6,
  Lighting: 0.5,
  Other: 0.8,
};

const MAX_HEIGHT_STRETCH = 1.5;
const MAX_HEIGHT_UNIFORM = 1.25;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Plausible real-world size (m) of an asset placed without a plan box. */
export function realDims(native: Dims | null | undefined, category: string | null | undefined): Dims {
  const range = CATEGORY_HEIGHT_RANGE_M[category || ""];
  const typicalH = range ? range[1] : 0.8;
  if (!native || native.w <= 0 || native.d <= 0 || native.h <= 0) return { w: 0.8, d: 0.8, h: typicalH };
  const s = (CATEGORY_LENGTH_M[category || ""] ?? 0.8) / Math.max(native.w, native.d);
  let sxz = s;
  let sy = s;
  const h = native.h * s;
  if (range && (h < range[0] || h > range[2])) {
    const g = (h < range[0] ? range[0] : range[2]) / h;
    const v = clamp(g, 1 / MAX_HEIGHT_STRETCH, MAX_HEIGHT_STRETCH);
    const u = clamp(g / v, 1 / MAX_HEIGHT_UNIFORM, MAX_HEIGHT_UNIFORM);
    sxz *= u;
    sy *= v * u;
  }
  return { w: r3(native.w * sxz), d: r3(native.d * sxz), h: r3(native.h * sy) };
}

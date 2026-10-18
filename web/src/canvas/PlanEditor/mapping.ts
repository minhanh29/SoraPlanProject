// Mapping-step math: decorations per plan box, footprint <-> dims, stretch detection. Pure.
import type { Asset, Dims, MappingEntry, MissingEntry, PlanUnits } from "../../lib/types";
import { rad2deg } from "../../lib/units";
import { isBox, type EditorObject } from "./model";
import type { Decoration } from "./render";

export type MapState = "matched" | "generating" | "failed" | "missing" | "skipped";

export function entryState(entry: MappingEntry | undefined, asset: Asset | undefined, inMissing: boolean): MapState {
  if (!entry) return inMissing ? "missing" : "missing";
  if (entry.skipped) return "skipped";
  if (!entry.assetId) return "missing";
  if (!asset) return "generating";
  if (asset.status === "ready") return "matched";
  if (asset.status === "failed") return "failed";
  return "generating";
}

/** Plan-degree rotation of the model footprint (scene rotationY = -deg2rad(box.rotation) + rotationOffset). */
export function footprintRotation(boxRotationDeg: number, rotationOffset = 0): number {
  return (boxRotationDeg || 0) - rad2deg(rotationOffset || 0);
}

export function buildDecorations(
  objects: EditorObject[],
  mapping: Record<string, MappingEntry>,
  missing: MissingEntry[],
  assets: Record<string, Asset>,
  k: number,
  dimsOverride: Record<string, Dims>,
  imageFor: (url: string) => HTMLImageElement | null,
): Record<string, Decoration> {
  const missingIds = new Set(missing.map((m) => m.componentId));
  const out: Record<string, Decoration> = {};
  for (const o of objects) {
    if (!isBox(o)) continue;
    const entry = mapping[o.id];
    const asset = entry?.assetId ? assets[entry.assetId] : undefined;
    const state = entryState(entry, asset, missingIds.has(o.id));
    const dims = dimsOverride[o.id] || entry?.dims || null;
    const dec: Decoration = { kind: state, category: entry?.category ?? o.category ?? null };
    if (state === "matched" || state === "generating") {
      const imageUrl = asset?.thumbUrl || asset?.imageUrl;
      dec.image = imageUrl ? imageFor(imageUrl) : null;
      dec.progress = asset?.progress || 0;
      if (dims && state === "matched") {
        dec.footprint = { w: dims.w / k, d: dims.d / k, rotation: footprintRotation(o.rotation, entry?.rotationOffset) };
        // The auto fit already stretches a little on purpose; flag only edits that go beyond it.
        dec.stretched = isStretched(dims, entry?.autoDims || asset?.dims || null);
      }
    }
    out[o.id] = dec;
  }
  return out;
}

/** True when any axis deviates more than `tolerance` from the reference proportions (auto fit or native model). */
export function isStretched(dims: Dims, native: Dims | null, tolerance = 0.2): boolean {
  if (!native || native.w <= 0 || native.d <= 0 || native.h <= 0) return false;
  const s = [dims.w / native.w, dims.d / native.d, dims.h / native.h];
  const max = Math.max(...s);
  const min = Math.min(...s);
  return min > 0 && max / min - 1 > tolerance;
}

export function scaleDims(d: Dims, f: number): Dims {
  return { w: d.w * f, d: d.d * f, h: d.h * f };
}

/** Change one axis; with the ratio lock all three scale by the same factor. */
export function setAxis(d: Dims, axis: keyof Dims, value: number, lock: boolean): Dims {
  if (!(value > 0)) return d;
  if (lock && d[axis] > 0) return scaleDims(d, value / d[axis]);
  return { ...d, [axis]: value };
}

export const MIN_DIM = 0.05;
export function clampDims(d: Dims): Dims {
  const c = (v: number) => Math.max(MIN_DIM, Math.min(12, v));
  return { w: c(d.w), d: c(d.d), h: c(d.h) };
}

/** Parse a length typed in the inspector into meters: cm for metric plans, ft-in (6'2", 6′2″, 6.5) for feet. */
export function parseLength(text: string, units: PlanUnits): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (units === "ft") {
    const m = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|′|ft)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|in)?)?$/);
    if (!m) return null;
    const ft = parseFloat(m[1]);
    const inch = m[2] ? parseFloat(m[2]) : 0;
    const v = (ft * 12 + inch) * 0.0254;
    return v > 0 ? v : null;
  }
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(cm|m|mm)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const v = m[2] === "m" ? n : m[2] === "mm" ? n / 1000 : n / 100;
  return v > 0 ? v : null;
}

/** Component ids mapped to the same asset (for "Apply to all"). */
export function sameAssetIds(mapping: Record<string, MappingEntry>, componentId: string): string[] {
  const a = mapping[componentId]?.assetId;
  if (!a) return [componentId];
  return Object.entries(mapping)
    .filter(([, e]) => e.assetId === a && !e.skipped)
    .map(([id]) => id);
}

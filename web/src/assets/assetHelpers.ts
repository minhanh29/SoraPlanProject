import type { Asset, StyleId } from "../lib/types";

export type StyleFilter = "all" | StyleId;

/** Case-insensitive search on name and category, plus an optional style filter. */
export function filterAssets(assets: Asset[], search: string, style: StyleFilter = "all"): Asset[] {
  const q = search.trim().toLowerCase();
  return assets.filter((a) => {
    if (style !== "all" && a.style !== style) return false;
    if (!q) return true;
    return (a.name || "").toLowerCase().includes(q) || (a.category || "").toLowerCase().includes(q);
  });
}

/** Status pill for a card; null when the asset is ready (no pill shown). */
export function statusLabel(a: Pick<Asset, "status" | "progress">): { text: string; tone: "accent" | "danger" | "neutral" } | null {
  switch (a.status) {
    case "ready":
      return null;
    case "generating_3d":
      return { text: `Generating 3D ${Math.max(0, Math.min(100, Math.round(a.progress || 0)))}%`, tone: "accent" };
    case "failed":
      return { text: "Failed", tone: "danger" };
    default:
      return { text: "Uploaded", tone: "neutral" };
  }
}

/** Newest first; assets without a date go last. */
export function sortAssets(assets: Asset[]): Asset[] {
  return [...assets].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Validation message for a picked photo, or null when acceptable. */
export function validatePhoto(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return "Please choose a PNG, JPEG or WebP photo.";
  if (file.size > MAX_UPLOAD_BYTES) return "That photo is larger than 25 MB.";
  return null;
}

/** "my-oak_chair.jpg" → "My oak chair". */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "My item";
}

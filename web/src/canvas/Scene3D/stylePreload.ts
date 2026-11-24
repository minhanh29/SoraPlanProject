import type { Asset, SceneGraph } from "../../lib/types";
import { getLoadedModel, loadModel } from "../../three/loadModel";

const MAX_MODELS = 16;
// Mirror the bathroom fixture family used by the style switcher on the API.
const styleCategory = (category: string) => category === "Sink" ? "Bathroom Vanity" : category;

/** Warm only optimized catalog models for furniture categories actually used by this home. */
export function styleModelUrls(graph: SceneGraph | null, assets: Record<string, Asset>): string[][] {
  if (!graph) return [];
  const categories = new Map<string, number>();
  for (const item of graph.levels[0]?.items || []) {
    const current = item.assetId ? assets[item.assetId] : undefined;
    if (current && !current.isSystem) continue;
    const category = current?.category || item.category;
    if (category) {
      const key = styleCategory(category);
      categories.set(key, (categories.get(key) || 0) + 1);
    }
  }
  const candidates = Object.values(assets)
    .filter((a) => a.isSystem && a.status === "ready" && a.style && a.style !== graph.meta.style && a.category && categories.has(styleCategory(a.category)) && a.glbWebUrl)
    .sort((a, b) => (categories.get(styleCategory(b.category!)) || 0) - (categories.get(styleCategory(a.category!)) || 0) || a.id.localeCompare(b.id));
  return [...new Set(candidates.map((a) => a.glbWebUrl!))].slice(0, MAX_MODELS).map((url) => [url]);
}

/** Limit background downloads/decoding so they do not crowd out the current scene. */
export async function preloadStyleModels(groups: string[][], signal: AbortSignal): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < groups.length) {
      const urls = groups[next++];
      if (getLoadedModel(urls)) continue;
      try { await loadModel(urls); } catch { /* A failed preload must not block the home or the switch. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, groups.length) }, worker));
}

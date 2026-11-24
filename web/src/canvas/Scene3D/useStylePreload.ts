import { useEffect, useMemo } from "react";
import type { Asset, SceneGraph } from "../../lib/types";
import { preloadStyleModels, styleModelUrls } from "./stylePreload";

export function useStylePreload(graph: SceneGraph | null, assets: Record<string, Asset>) {
  const groups = useMemo(() => styleModelUrls(graph, assets), [graph, assets]);
  const key = JSON.stringify(groups);
  useEffect(() => {
    const abort = new AbortController();
    // Let the visible home start loading before warming the other collection.
    const timer = window.setTimeout(() => void preloadStyleModels(JSON.parse(key), abort.signal), 2000);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [key]);
}

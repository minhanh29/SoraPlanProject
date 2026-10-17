// Full-bleed photo behind the shell. Pages pick a scene with useBackdrop(); the photo follows the
// theme (day for light, dusk for dark) and crossfades whenever the scene or the theme changes.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "../lib/theme";
import type { Stage } from "../lib/types";

/** Scenes in public/art/{scene}-{day|dusk}.webp (made by scripts/art/generate.py). */
export type BackdropScene = "desk" | "lift" | "model" | "room";

/** The house gets built as the workflow moves on: drawing → wireframe → model → finished room. */
export const STAGE_SCENE: Record<Stage, BackdropScene> = {
  uploading: "desk",
  cropping: "desk",
  parsing: "lift",
  reviewing_plan: "model",
  choosing_style: "model",
  resolving_missing: "model",
  scene_ready: "room",
};

let current: BackdropScene | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Show `scene` behind the shell while the calling page is mounted (null = plain background). */
export function useBackdrop(scene: BackdropScene | null) {
  useEffect(() => {
    current = scene;
    listeners.forEach((fn) => fn());
    return () => {
      current = null;
      listeners.forEach((fn) => fn());
    };
  }, [scene]);
}

export default function Backdrop() {
  const scene = useSyncExternalStore(subscribe, () => current);
  const theme = useTheme();
  const src = scene ? `/art/${scene}-${theme === "dark" ? "dusk" : "day"}.webp` : "none";
  // The newest layer fades in over the previous one, which is dropped once the fade ends
  const [layers, setLayers] = useState([src]);
  useEffect(() => setLayers((l) => (l[l.length - 1] === src ? l : [...l.slice(-1), src])), [src]);
  const settle = (key: string) => setLayers((l) => (l[l.length - 1] === key ? [key] : l));

  return (
    <div className="backdrop" aria-hidden="true">
      {layers.map((key) =>
        key === "none" ? (
          <div key={key} className="backdrop__layer backdrop__layer--none" ref={(el) => el && requestAnimationFrame(() => el.classList.add("is-in"))}
            onTransitionEnd={() => settle(key)} />
        ) : (
          <img key={key} className="backdrop__layer" src={key} alt="" decoding="async"
            onLoad={(e) => e.currentTarget.classList.add("is-in")} onTransitionEnd={() => settle(key)} />
        ),
      )}
    </div>
  );
}

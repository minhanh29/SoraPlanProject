import { useEffect, useState } from "react";
import { cssVar } from "../../lib/theme";

export interface SceneColors {
  background: string;
  select: string;
  danger: string;
}

function read(): SceneColors {
  return {
    background: cssVar("--scene-bg", "#eef1f5"),
    select: cssVar("--plan-select", "#7048e8"),
    danger: cssVar("--danger", "#d6336c"),
  };
}

/** Theme tokens for WebGL; refreshed on the app's theme toggle event. */
export function useSceneColors(): SceneColors {
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const onTheme = () => requestAnimationFrame(() => setColors(read()));
    window.addEventListener("soraplan:theme", onTheme);
    return () => window.removeEventListener("soraplan:theme", onTheme);
  }, []);
  return colors;
}

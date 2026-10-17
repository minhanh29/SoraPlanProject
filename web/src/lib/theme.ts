export type Theme = "light" | "dark";
const KEY = "soraplan.theme";

export function getTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent("soraplan:theme", { detail: theme }));
}

/** Read a CSS token (e.g. "--accent") for canvas/WebGL code that cannot use CSS directly. */
export function cssVar(name: string, fallback = "#000"): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

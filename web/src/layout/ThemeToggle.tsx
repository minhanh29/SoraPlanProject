import { useEffect, useState } from "react";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { Icon } from "../components/ui";

export default function ThemeToggle({ compact }: { compact?: boolean }) {
  const [theme, set] = useState<Theme>(getTheme());
  useEffect(() => {
    const on = (e: Event) => set((e as CustomEvent<Theme>).detail);
    window.addEventListener("soraplan:theme", on);
    return () => window.removeEventListener("soraplan:theme", on);
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button className="side-btn" onClick={() => setTheme(next)} title={`Switch to ${next} theme`} aria-label={`Switch to ${next} theme`}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
      {!compact && <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>}
    </button>
  );
}

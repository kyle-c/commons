import { useEffect, useState } from "react";
import { effectiveTheme, onSystemThemeChange, setThemePreference } from "../lib/theme";
import { registerShortcut } from "../lib/shortcuts";
import Icon from "../components/icons";

/**
 * Titlebar theme control: shows the theme you're in, click flips it. "System"
 * exists only as the untouched default — surfacing it as a third stop in a
 * cycle made a monitor icon that seemed to do nothing (system + dark OS looks
 * identical to dark). ⌘L does the same flip.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">(effectiveTheme());
  const flip = () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    setThemePreference(next);
    setTheme(next);
  };

  // If the pref is still "system", a macOS appearance change flips us too.
  useEffect(() => onSystemThemeChange(() => setTheme(effectiveTheme())), []);
  useEffect(
    () => registerShortcut("l", flip, { meta: true, description: "Toggle light/dark theme" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <button
      className="btn ghost icon-btn"
      aria-label="Theme"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme (⌘L)`}
      onClick={flip}
    >
      <Icon name={theme === "dark" ? "moon" : "sun"} />
    </button>
  );
}

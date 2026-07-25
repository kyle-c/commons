import { useEffect, useState } from "react";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";
import { registerShortcut } from "../lib/shortcuts";
import Icon, { type IconName } from "../components/icons";

const NEXT: Record<ThemePreference, ThemePreference> = { dark: "light", light: "system", system: "dark" };
const ICON: Record<ThemePreference, IconName> = { dark: "moon", light: "sun", system: "monitor" };

/** Titlebar theme control: click cycles dark → light → system; ⌘L toggles. */
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference());
  const set = (p: ThemePreference) => {
    setThemePreference(p);
    setPref(p);
  };

  useEffect(
    () =>
      registerShortcut("l", () => set(getThemePreference() === "light" ? "dark" : "light"), {
        meta: true,
        description: "Toggle light/dark theme",
      }),
    []
  );

  return (
    <button
      className="btn ghost icon-btn"
      aria-label="Theme"
      title={`Theme: ${pref} — click cycles dark → light → system (⌘L toggles)`}
      onClick={() => set(NEXT[pref])}
    >
      <Icon name={ICON[pref]} />
    </button>
  );
}

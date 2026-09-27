/**
 * Theme switching. The default follows the system appearance (macOS, or the
 * browser's setting on the web), so a light machine opens onto the same sand
 * and paper as trycommons.app. Picking light or dark sticks until "Match
 * system" is chosen again. Tokens live in theme.css under :root (dark) and
 * :root[data-theme="light"].
 */
export type ThemePreference = "dark" | "light" | "system";

const THEME_KEY = "commons.theme";
const media = window.matchMedia("(prefers-color-scheme: light)");

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function resolve(pref: ThemePreference): "dark" | "light" {
  return pref === "system" ? (media.matches ? "light" : "dark") : pref;
}

function apply(pref: ThemePreference): void {
  const mode = resolve(pref);
  document.documentElement.dataset.theme = mode;
  // The Dock icon follows the app theme (desktop only, running app only).
  void window.commons?.setDockAppearance(mode);
}

export function setThemePreference(pref: ThemePreference): void {
  localStorage.setItem(THEME_KEY, pref);
  apply(pref);
}

/** What the user actually sees right now — "system" resolved to a mode. */
export function effectiveTheme(): "dark" | "light" {
  return resolve(getThemePreference());
}

/** Notifies when the effective theme may have changed via macOS appearance. */
export function onSystemThemeChange(cb: () => void): () => void {
  media.addEventListener("change", cb);
  return () => media.removeEventListener("change", cb);
}

/** Call once at startup; keeps "system" in sync with macOS appearance. */
export function initTheme(): void {
  apply(getThemePreference());
  media.addEventListener("change", () => apply(getThemePreference()));
}

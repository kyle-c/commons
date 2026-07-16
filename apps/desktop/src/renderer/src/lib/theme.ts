/**
 * Theme switching. Dark chrome is the default (SPEC aesthetic); light is an
 * explicit choice, "system" follows macOS. Tokens live in theme.css under
 * :root (dark) and :root[data-theme="light"].
 */
export type ThemePreference = "dark" | "light" | "system";

const THEME_KEY = "commons.theme";
const media = window.matchMedia("(prefers-color-scheme: light)");

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "system" ? stored : "dark";
}

function resolve(pref: ThemePreference): "dark" | "light" {
  return pref === "system" ? (media.matches ? "light" : "dark") : pref;
}

function apply(pref: ThemePreference): void {
  document.documentElement.dataset.theme = resolve(pref);
}

export function setThemePreference(pref: ThemePreference): void {
  localStorage.setItem(THEME_KEY, pref);
  apply(pref);
}

/** Call once at startup; keeps "system" in sync with macOS appearance. */
export function initTheme(): void {
  apply(getThemePreference());
  media.addEventListener("change", () => apply(getThemePreference()));
}

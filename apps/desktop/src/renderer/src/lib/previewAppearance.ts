/**
 * The appearance embedded previews render with (canvas frames + Prototype).
 * Frames answer useColorScheme()-style queries from Chromium's color scheme,
 * which otherwise follows the Mac's system appearance — so a dark-mode Mac
 * silently forced every previewed app dark. Default is light: previewed
 * products usually design light-first, and Commons's chrome shouldn't leak
 * into the work. Desktop-only (nativeTheme); the browser app follows the OS.
 */
export type PreviewAppearance = "light" | "dark" | "system";

const KEY = "commons.previewAppearance";

export function getPreviewAppearance(): PreviewAppearance {
  const stored = localStorage.getItem(KEY);
  return stored === "dark" || stored === "system" ? stored : "light";
}

export function setPreviewAppearance(mode: PreviewAppearance): void {
  localStorage.setItem(KEY, mode);
  void window.commons?.setPreviewAppearance(mode);
}

/** Called once at launch so the stored preference takes effect. */
export function applyStoredPreviewAppearance(): void {
  void window.commons?.setPreviewAppearance(getPreviewAppearance());
}

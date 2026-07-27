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
  apply(mode);
}

/** Called once at launch so the stored preference takes effect. */
export function applyStoredPreviewAppearance(): void {
  apply(getPreviewAppearance());
}

function apply(mode: PreviewAppearance): void {
  // Primary mechanism: CSS color-scheme on the preview iframes propagates
  // into each child document as its prefers-color-scheme (CSS Color Adjust).
  // Works per-frame, applies instantly, and works in the browser app too —
  // styles.css maps this attribute onto the iframes.
  document.documentElement.dataset.previewAppearance = mode;
  // Desktop reinforcement: also steer Chromium's own scheme so anything
  // outside the CSS rule (popups, the preview harness) agrees.
  void window.commons?.setPreviewAppearance(mode);
}

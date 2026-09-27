/**
 * The brand's typefaces, shared with trycommons.app: Fraunces (soft, wonky)
 * for display moments, Figtree for the interface, Shantell Sans (a marker
 * hand) for tips and empty states only.
 *
 * Bundled rather than fetched, because the app's CSP allows no outside
 * fonts. Registered from script rather than a CSS @font-face, because the web
 * build serves its stylesheet from Convex storage after a redirect, and a
 * url() inside a stylesheet resolves against wherever the sheet ended up. A
 * FontFace built here resolves against the page, the same way the sticker
 * art does.
 *
 * All three are SIL Open Font License 1.1; the license texts sit beside the
 * font files in assets/fonts.
 */
import frauncesUrl from "../assets/fonts/fraunces-display.woff2";
import figtreeUrl from "../assets/fonts/figtree.woff2";
import shantellUrl from "../assets/fonts/shantell-sans.woff2";

const FACES: [family: string, url: string, weight: string][] = [
  // Pinned at weight 600 with the soft and wonky axes baked in; the
  // optical-size axis stays variable so titles and labels each look right.
  ["Fraunces", frauncesUrl, "600"],
  ["Figtree", figtreeUrl, "400 700"],
  ["Shantell Sans", shantellUrl, "500"],
];

/** Call once, before the first render. Failures fall back to the stacks in theme.css. */
export function loadBrandFonts(): void {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  for (const [family, url, weight] of FACES) {
    try {
      const face = new FontFace(family, `url(${JSON.stringify(url)}) format("woff2")`, { weight, display: "swap" });
      document.fonts.add(face);
      void face.load().catch(() => {});
    } catch {
      // An engine without FontFace support keeps the fallback stack.
    }
  }
}

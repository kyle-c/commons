/**
 * The Commons mark, from the commons-direction-1-3 sheet: a C folded like a
 * ribbon. One source, two forms:
 *
 * - The mark (the logo): a charcoal C with a peach top end and an orange
 *   bottom end, for light grounds. The site's header and footer, the share
 *   card.
 * - The tile (the app icon): an orange C with a peach cap and a cream end on a
 *   charcoal rounded square, for favicons and anywhere the mark has to bring
 *   its own ground (browser tabs can be dark). The Mac app's icons are rasters
 *   of the same artwork, sourced in apps/desktop/build/icon-src.
 */

type Shape = readonly [d: string, fill: string];

const MARK: readonly Shape[] = [
  ["M21.28 16.09C19.45 15.48 17.39 15.25 15.47 15.25C14.69 15.25 14.08 15.33 13.4 15.43L14.24 20.86C14.61 20.8 14.83 20.76 15.17 20.76C16.56 20.76 18.02 21.1 19.07 21.68C19.5 21.92 19.98 22.07 20.49 22.07C22.17 22.07 23.46 20.72 23.46 19.05C23.46 17.62 22.54 16.51 21.28 16.09Z", "#E5AE7C"],
  ["M18.33 27.15C17.49 28.11 16.09 28.8 14.77 28.8C12.56 28.8 10.85 27.04 10.85 24.77C10.85 22.75 12.37 21.14 14.24 20.86C15.36 20.69 16.15 19.47 16.15 18.15C16.15 16.59 14.76 15.23 13.4 15.43C8.87 16.11 5.42 20.01 5.42 24.77C5.42 30.31 9.76 34.17 14.88 34.17C17.02 34.17 19.12 33.65 20.5 32.8L20.5 27.15Z", "#282720"],
  // The fold under the orange end, a shade of the charcoal.
  ["M14.12 28.75C14.33 28.78 14.55 28.8 14.77 28.8C16.09 28.8 17.49 28.11 18.33 27.15L20.5 27.15L20.5 32.8C19.12 33.65 17.02 34.17 14.88 34.17C14.57 34.17 14.27 34.16 13.97 34.13C15.28 33.9 16.29 32.9 16.29 31.57C16.29 30.14 15.38 28.95 14.12 28.75Z", "#3A382F"],
  ["M20.45 26.27C22.11 26.27 23.46 27.62 23.46 29.29C23.46 30.25 23.11 31.03 22.54 31.58C21.76 32.33 20.64 33.01 19.68 33.01C18.07 33.01 16.64 31.75 16.64 30.02C16.64 28.29 18.73 26.27 20.45 26.27Z", "#D38A52"],
];

const TILE_GLYPH: readonly Shape[] = [
  ["M44.38 58.82C43.66 59.39 42.64 59.72 41.42 59.72C39.44 59.72 37.91 58.15 37.91 56.25C37.91 54.32 39.46 52.76 41.42 52.76C42.6 52.76 43.81 53.03 44.8 53.4L44.99 48.45C43.86 47.93 42.65 47.71 41.82 47.71C41.3 47.71 40.8 47.74 40.33 47.81C36.1 48.44 32.98 51.85 32.98 56.25C32.98 61.05 36.85 64.65 41.82 64.65C43.52 64.65 45.17 64.22 46.3 63.4L46.3 58.54Z", "#D38A52"],
  ["M42.87 61.78C42.87 63.26 41.77 64.48 40.36 64.54C40.84 64.61 41.32 64.65 41.82 64.65C43.52 64.65 45.17 64.22 46.3 63.4L46.3 58.54L44.38 58.82C44.16 58.99 43.92 59.14 43.65 59.27C43.12 59.52 42.87 60.85 42.87 61.78Z", "#B66F43"],
  ["M41.42 52.76C42.6 52.76 43.81 53.03 44.8 53.4L44.81 49.84L42.52 49.51C42.52 51.15 41.97 52.63 40.85 52.81C41.03 52.78 41.22 52.76 41.42 52.76Z", "#B66F43"],
  ["M47.25 48.8C45.53 48.05 43.59 47.71 41.82 47.71C41.3 47.71 40.8 47.74 40.33 47.81C41.61 47.97 42.47 49 42.71 50.31C43.05 52.18 44.69 53.92 46.26 53.92C47.74 53.92 48.89 52.76 48.89 51.32C48.89 50.2 48.2 49.21 47.25 48.8Z", "#E5AE7C"],
  ["M46.18 57.75C47.67 57.75 48.87 58.95 48.87 60.44C48.87 61.3 48.44 62.13 47.77 62.62C47.1 63.11 46.24 63.71 45.5 63.71C44.17 63.71 43.09 62.56 43.09 61.09C43.09 59.51 44.62 57.75 46.18 57.75Z", "#FAF7ED"],
];

const paths = (shapes: readonly Shape[]) => shapes.map(([d, fill]) => `<path d="${d}" fill="${fill}"/>`).join("");

/** The mark (the logo) as inline SVG, `size` px tall. Decorative: pair it with the name. */
export function commonsMarkSvg(size: number): string {
  const width = Math.round(size * (18.44 / 19.32) * 100) / 100;
  return `<svg width="${width}" height="${size}" viewBox="5.22 15.05 18.44 19.32" aria-hidden="true">${paths(MARK)}</svg>`;
}

/**
 * The tile (the app icon) as SVG on a 32-unit square. The glyph is scaled
 * from its 15.91 x 16.94 artwork to 62% of the tile, nudged right a touch
 * because a C's weight sits on its left.
 */
export function commonsTileSvg(size = 32): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7.2" fill="#282720"/>` +
    `<g transform="translate(-31.54 -49.8) scale(1.1712)">${paths(TILE_GLYPH)}</g></svg>`
  );
}

/** The tile as a data: URI, for <link rel="icon"> on pages served without assets. */
export const COMMONS_FAVICON_HREF = "data:image/svg+xml," + encodeURIComponent(commonsTileSvg());

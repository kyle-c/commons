/**
 * Keeping other people's code apart from ours.
 *
 * Commons shows running apps inside its own pages: a teammate's dev server, a
 * deployed preview, a build the customer's CI uploaded. All of it is someone
 * else's script, and the browser app keeps the signed-in session in
 * localStorage on its own origin. Script that shares that origin reads the
 * token and is the user. Two rules keep them apart, and both sides of the
 * product have to agree on them, so they live here:
 *
 * - Previews are served from a different host than the app (see hostSplit.ts
 *   in the backend), so a preview's origin never holds a session.
 * - Every embedded screen is sandboxed (frameSandbox below), so even an
 *   address on our own origin cannot act as us.
 */

/** Where the browser app keeps its session: localStorage, on the app's own origin. */
export const SESSION_STORAGE_KEY = "commons.session";

/**
 * A web address, the only kind Commons frames or opens. The others are not
 * places: a `javascript:` address is a script, and one given to a frame or to
 * window.open runs as the page that used it, whatever sandbox the frame has.
 * Preview addresses are data (a teammate types them, a deploy reports them),
 * so every path from that data to a frame or a new window asks this first.
 */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * What an embedded screen may do: everything a working app needs, nothing
 * that reaches the page around it. Top navigation is the token withheld on
 * purpose. Without it a framed app cannot replace the Commons tab, which is
 * the first thing a frame-busting script (or a phishing page) tries.
 */
const FRAME_SANDBOX = [
  "allow-scripts",
  "allow-same-origin",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-downloads",
] as const;

/**
 * Withheld from an address on our own origin: the origin itself, and the
 * popup escape that would hand it back (a window opened from a sandboxed
 * frame is sandboxed too unless that token is set).
 */
const NOT_ON_OUR_ORIGIN: readonly string[] = ["allow-same-origin", "allow-popups-to-escape-sandbox"];

/**
 * The `sandbox` attribute for a frame showing `frameUrl` inside a page at
 * `embedderOrigin` (`location.origin`).
 *
 * allow-same-origin lets a frame keep its own origin: its storage, its
 * cookies, calls to its own backend. That is harmless for every origin but
 * ours. An address on the embedding page's own origin is the one case where
 * the token would hand the frame our storage, session included, so there it
 * is withheld (NOT_ON_OUR_ORIGIN) and the document runs with an origin of its
 * own. An address that cannot be read gets the same strict treatment.
 */
export function frameSandbox(frameUrl: string, embedderOrigin: string): string {
  // Absolute web addresses only. A relative address is ours by definition
  // (and the desktop app's own page has no origin to resolve it against);
  // anything that is not a web address gets the strict treatment and is not
  // framed at all by AppFrame.
  const ours = !isWebUrl(frameUrl) || new URL(frameUrl).origin === embedderOrigin;
  return FRAME_SANDBOX.filter((token) => !(ours && NOT_ON_OUR_ORIGIN.includes(token))).join(" ");
}

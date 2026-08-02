/**
 * The pure half of the runtime survey: everything that can be decided from
 * data, kept apart from the Electron window that produces the data — the
 * decisions are where correctness lives, and this file is testable while a
 * hidden Chromium is not.
 *
 * Vocabulary:
 * - A page's SIGNATURE is a structural fingerprint (landmark skeleton plus
 *   bucketed text mass), so "the same screen" is judged by shape, not pixels
 *   or URL. Two routes rendering one login form share a signature; one route
 *   rendering a modal grows a new one.
 * - A GATE is the signature the app collapses into when it refuses you:
 *   many requested routes, one shape, and that shape asks for credentials.
 */

export interface PageObservation {
  /** The path actually requested. */
  requestedPath: string;
  /** Where the app ended up (redirects tell on auth gates). */
  landedPath: string;
  signature: string;
  hasCredentialFields: boolean;
  title: string;
  /** Same-origin paths discovered in the page's links. */
  linkedPaths: string[];
}

/** Paths worth visiting: same-app pages, not assets, not off-canvas schemes. */
export function crawlablePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (/\.(png|jpe?g|svg|gif|webp|ico|css|js|map|pdf|zip|mp4|webm|woff2?)($|\?)/i.test(path)) return false;
  if (path.startsWith("/api/") || path.startsWith("/_next/")) return false;
  return true;
}

/** "/posts/42" and "/posts/7" are one screen: collapse numeric/uuid-ish segments. */
export function collapseDynamic(path: string): string {
  return path
    .split("?")[0]
    .split("/")
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /^[0-9a-f]{16,}$/i.test(seg)
        ? "[param]"
        : seg
    )
    .join("/");
}

/**
 * The auth gate, found rather than assumed: the signature that at least
 * three distinct requested routes collapsed into, where the rendered page
 * asks for credentials. Routes that landed there are gated; the gate itself
 * is a real screen (usually already on the canvas as /login).
 */
export function detectGate(observations: PageObservation[]): { signature: string; gatedRoutes: string[] } | null {
  const bySignature = new Map<string, PageObservation[]>();
  for (const o of observations) {
    if (!bySignature.has(o.signature)) bySignature.set(o.signature, []);
    bySignature.get(o.signature)!.push(o);
  }
  for (const [signature, group] of bySignature) {
    const requested = new Set(group.map((o) => collapseDynamic(o.requestedPath)));
    if (requested.size >= 3 && group.some((o) => o.hasCredentialFields)) {
      return { signature, gatedRoutes: [...requested].sort() };
    }
  }
  return null;
}

/**
 * Which observations are screens the canvas doesn't have. Judged per
 * collapsed path, excluding anything that landed on the gate — proposing
 * five copies of the login page is exactly the lie the survey exists to end.
 */
export function newScreens(
  observations: PageObservation[],
  knownRoutes: string[],
  gateSignature: string | null
): PageObservation[] {
  const known = new Set(knownRoutes.map(collapseDynamic));
  const seen = new Set<string>();
  const fresh: PageObservation[] = [];
  for (const o of observations) {
    if (gateSignature && o.signature === gateSignature) continue;
    const path = collapseDynamic(o.landedPath);
    if (known.has(path) || seen.has(path)) continue;
    seen.add(path);
    fresh.push(o);
  }
  return fresh;
}

/** Breadth-first frontier: paths linked from what we saw but never visited. */
export function nextToVisit(
  observations: PageObservation[],
  visited: Set<string>,
  budget: number
): string[] {
  const out: string[] = [];
  for (const o of observations) {
    for (const raw of o.linkedPaths) {
      const path = raw.split("#")[0];
      if (!crawlablePath(path)) continue;
      if (path.includes("[")) continue; // an unfilled pattern is not an address
      const key = collapseDynamic(path);
      if (visited.has(key)) continue;
      visited.add(key);
      out.push(path);
      if (out.length >= budget) return out;
    }
  }
  return out;
}

/**
 * The pure half of a survey: everything that can be decided from data, kept
 * apart from whatever produces the data. The decisions are where correctness
 * lives, and this file is testable while a hidden Chromium is not.
 *
 * Two things produce the data. The Mac app loads each page in a hidden
 * window and observes it from inside (surveyor.ts). The backend, reading a
 * pasted URL for someone in a browser, has only the HTML the server sent
 * (observeHtml below). Both hand the same PageObservation to the same rules,
 * so "a screen", "a sign-in gate" and "already visited" mean one thing.
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

/** A page's signature from its skeleton: short, stable, and only ever compared within one survey. */
export function signatureOf(skeleton: string): string {
  let h = 0;
  for (let i = 0; i < skeleton.length; i += 1) h = (Math.imul(h, 31) + skeleton.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** "user-settings" and "(tabs)" as people would title them. */
export function humanizeSegment(segment: string): string {
  return segment
    .replace(/^\(|\)$/g, "")
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Sections for routes no router group named: the first URL segment, but only
 * when at least two routes share it. A singleton stays ungrouped rather than
 * becoming a one-screen section.
 */
export function sectionByFirstSegment<R extends { path: string; section?: string }>(routes: R[]): void {
  const counts = new Map<string, number>();
  for (const route of routes) {
    if (route.section) continue;
    const first = route.path.split("?")[0].split("/")[1];
    if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  for (const route of routes) {
    if (route.section) continue;
    const first = route.path.split("?")[0].split("/")[1];
    if (first && (counts.get(first) ?? 0) >= 2) route.section = humanizeSegment(first);
  }
}

// ── Reading a page from its HTML ────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] !== "#") return ENTITIES[body.toLowerCase()] ?? whole;
    const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
  });
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/** What is left of the markup once the parts nobody sees are gone. */
function visibleMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

/**
 * One page, observed from the HTML its server sent: the same observation the
 * runtime survey makes from inside a loaded page, minus everything JavaScript
 * would have added. `landedUrl` is where the request ended up after redirects.
 */
export function observeHtml(html: string, requestedPath: string, landedUrl: string): PageObservation {
  const landed = new URL(landedUrl);
  const markup = visibleMarkup(html);

  const links = new Set<string>();
  for (const tag of markup.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attribute(tag, "href");
    if (!href) continue;
    try {
      const url = new URL(href, landed);
      if (url.origin === landed.origin) links.add(url.pathname + url.search);
    } catch {
      // Not an address.
    }
    if (links.size >= 60) break;
  }

  const landmarks = (markup.match(/<(?:main|nav|header|footer|aside|form|h1|h2|table|dialog)\b[^>]*>|<[a-z][^>]*\srole\s*=\s*["']?dialog\b[^>]*>/gi) ?? [])
    .slice(0, 40)
    .map((tag) => tag.match(/^<([a-z0-9]+)/i)![1].toUpperCase() + (attribute(tag, "role") ?? ""));
  const text = decodeEntities(markup.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const inputs = (markup.match(/<input\b[^>]*>/gi) ?? []).map((tag) => (attribute(tag, "type") ?? "text").toLowerCase());

  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  const heading = markup.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1];
  const clean = (fragment: string | undefined) =>
    decodeEntities((fragment ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

  return {
    requestedPath,
    landedPath: landed.pathname + landed.search,
    signature: signatureOf(`${landmarks.join(",")}|${Math.round(text.length / 200)}|${[...inputs].sort().join(",")}`),
    hasCredentialFields: inputs.includes("password") || (inputs.includes("email") && inputs.length <= 3),
    title: (clean(titleTag) || clean(heading)).slice(0, 60),
    linkedPaths: [...links],
  };
}

/**
 * An empty shell: markup that says almost nothing and leaves the rest to its
 * scripts. Read as text, such an app has one screen, whatever it has when it
 * runs, and whoever asked should be told that rather than shown a canvas of
 * one frame as if it were the whole product.
 */
export function looksClientRendered(html: string): boolean {
  const markup = visibleMarkup(html);
  const text = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const links = (markup.match(/<a\b[^>]*\shref\s*=/gi) ?? []).length;
  return /<script\b/i.test(html) && text.length < 240 && links < 3;
}

/**
 * Page titles without the part every page shares. "Pricing | Acme" and
 * "Docs | Acme" become "Pricing" and "Docs"; the shared part is the site's
 * own name, returned so the project can be called that. A title that is
 * nothing but the shared part (the home page's, usually) is left empty for
 * the caller to name from its path.
 */
export function splitSharedTitle(titles: string[]): { site: string; pages: string[] } {
  const SEPARATOR = /\s+[|\u00b7\u2013\u2014:\-]\s+/;
  const counts = new Map<string, number>();
  for (const title of titles) {
    const parts = title.split(SEPARATOR);
    for (const part of new Set([parts[0], parts[parts.length - 1]])) {
      if (part) counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }
  // The site's name is the edge part most titles carry. One page proves nothing.
  let site = "";
  let best = 1;
  for (const [part, count] of counts) {
    if (count > best && count >= Math.ceil(titles.length / 2)) {
      site = part;
      best = count;
    }
  }
  if (!site) return { site: "", pages: [...titles] };
  return {
    site,
    pages: titles.map((title) =>
      title
        .split(SEPARATOR)
        .filter((part) => part !== site)
        .join(" - ")
        .trim()
    ),
  };
}

/**
 * Reading a site from its address: what the server does when someone pastes
 * a URL instead of pointing at a repo. Pure apart from the page fetcher it is
 * handed, so the whole walk is testable against a made-up site (urlRead.ts
 * supplies the real fetcher, with its timeouts and address checks).
 *
 * It follows the site's own links, breadth first and on a budget, and judges
 * what it finds with the same rules as the Mac app's runtime survey
 * (@commons/shared survey.ts): a screen is a page of its own shape, routes
 * that all collapse into one sign-in form are gated, and /posts/1 and
 * /posts/2 are one screen.
 *
 * What it cannot see, it says. HTML is all a server gets: an app that draws
 * its screens with JavaScript reads as one empty page, and whatever sits
 * behind sign-in reads as the sign-in page. Both are reported rather than
 * papered over, because a canvas that quietly shows a tenth of a product is
 * worse than one that says what is missing.
 */

import {
  collapseDynamic,
  crawlablePath,
  detectGate,
  looksClientRendered,
  newScreens,
  nextToVisit,
  observeHtml,
  sectionByFirstSegment,
  splitSharedTitle,
  type PageObservation,
} from "@commons/shared";

export interface Fetched {
  /** Where the request ended up, after redirects within public hosts. */
  url: string;
  status: number;
  contentType: string;
  /** Response headers, names lowercased. */
  headers: Record<string, string>;
  /** The body as text, already capped by the fetcher. */
  body: string;
  /** Set instead of following when a redirect pointed off the site: the host it pointed at. */
  leftSiteFor?: string;
}

/** Null when the page could not be had at all: unreachable, timed out, or an address the server must not call. */
export type FetchPage = (url: string, options: { stayOn: string | null }) => Promise<Fetched | null>;

export interface SiteReading {
  /** The site's canonical origin, after its own redirects (example.com to www.example.com). */
  origin: string;
  /** What to call the project. */
  name: string;
  pages: { path: string; title: string; section?: string }[];
  pagesRead: number;
  /** Routes that showed a sign-in form, or sent the reader to another host to sign in. */
  gatedRoutes: string[];
  /** The response header that forbids showing this site inside another page, if one does. */
  refusesFraming: string | null;
  /** The markup is an empty shell: screens that appear once JavaScript runs were not read. */
  clientRendered: boolean;
  /** The budget ran out with links still unread. */
  more: boolean;
}

export type ReadResult = { ok: true; site: SiteReading } | { ok: false; reason: string };

export interface ReadOptions {
  /** Pages to read at most. */
  budget: number;
  /** Requests in flight at once. */
  concurrency: number;
  /** Stop starting new requests after this many milliseconds. */
  deadlineMs: number;
  /** The origin Commons frames from; framing is judged against it. */
  embedderOrigin: string;
  now?: () => number;
}

const isHtml = (page: Fetched) => /\b(text\/html|application\/xhtml\+xml)\b/i.test(page.contentType);

/** "/" is Home; anything else is named from its path, as discovered routes are. */
function titleFromPath(path: string): string {
  const segments = path.split("?")[0].split("/").filter(Boolean);
  return segments.length === 0 ? "Home" : segments.map((s) => decodeURIComponent(s).replace(/[-_]+/g, " ")).join(" / ");
}

/**
 * The header that stops this site being shown inside a page at
 * `embedderOrigin`, or null. frame-ancestors wins over X-Frame-Options where
 * both are sent, as it does in browsers.
 */
export function framingRefusal(headers: Record<string, string>, embedderOrigin: string): string | null {
  const embedder = new URL(embedderOrigin);
  const policies = (headers["content-security-policy"] ?? "").split(",");
  let sawAncestors = false;
  for (const policy of policies) {
    const directive = policy
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .find((parts) => parts[0]?.toLowerCase() === "frame-ancestors");
    if (!directive) continue;
    sawAncestors = true;
    const allowed = directive.slice(1).some((raw) => {
      const source = raw.toLowerCase();
      if (source === "*") return true;
      if (source === "'none'" || source === "'self'") return false;
      if (/^[a-z][a-z0-9+.-]*:$/.test(source)) return source === embedder.protocol;
      const match = source.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\*|\d+))?/);
      if (!match) return false;
      const [, scheme, wildcard, host, port] = match;
      if (scheme && `${scheme}:` !== embedder.protocol) return false;
      if (port && port !== "*" && port !== (embedder.port || "443")) return false;
      return wildcard ? embedder.hostname.endsWith(`.${host}`) : embedder.hostname === host;
    });
    if (!allowed) return `Content-Security-Policy: ${directive.join(" ")}`;
  }
  if (sawAncestors) return null;
  const xfo = (headers["x-frame-options"] ?? "").trim().toUpperCase();
  return xfo === "DENY" || xfo === "SAMEORIGIN" ? `X-Frame-Options: ${xfo}` : null;
}

/** Paths robots.txt asks everyone (or Commons by name) to stay out of, and the sitemaps it names. */
export function parseRobots(text: string): { disallow: string[]; sitemaps: string[] } {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let applies = false;
  let inAgents = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "sitemap") {
      sitemaps.push(value);
    } else if (field === "user-agent") {
      // Consecutive user-agent lines head one group.
      const mine = value === "*" || value.toLowerCase().includes("commons");
      applies = inAgents ? applies || mine : mine;
      inAgents = true;
    } else {
      inAgents = false;
      if (field === "disallow" && applies && value) disallow.push(value);
    }
  }
  return { disallow, sitemaps };
}

function allowedByRobots(path: string, disallow: string[]): boolean {
  return !disallow.some((rule) => {
    const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    return new RegExp(`^${pattern}`).test(path);
  });
}

const lastTwoLabels = (host: string) => host.split(":")[0].split(".").slice(-2).join(".");

export async function readSite(startUrl: string, fetchPage: FetchPage, options: ReadOptions): Promise<ReadResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const asked = new URL(startUrl);

  // The first request may change hosts (example.com to www.example.com):
  // wherever it settles is the site.
  const first = await fetchPage(startUrl, { stayOn: null });
  if (!first) {
    return { ok: false, reason: `Commons couldn't reach ${asked.host}. Check the address, and that the site is up and open to the internet.` };
  }
  if (first.status >= 400) {
    return { ok: false, reason: `${asked.host} answered with a ${first.status} at that address.` };
  }
  if (!isHtml(first)) {
    return { ok: false, reason: "That address is a file, not a page. Paste the address of a page in the app." };
  }
  const landed = new URL(first.url);
  const firstSeen = observeHtml(first.body, asked.pathname + asked.search, first.url);

  // Sent to another company's host to sign in before seeing anything: there
  // is nothing to read from outside. The project still gets its front door.
  const signInElsewhere = lastTwoLabels(landed.host) !== lastTwoLabels(asked.host) && firstSeen.hasCredentialFields;
  if (signInElsewhere) {
    return {
      ok: true,
      site: {
        origin: asked.origin,
        name: asked.hostname.replace(/^www\./, ""),
        pages: [{ path: asked.pathname + asked.search, title: titleFromPath(asked.pathname) }],
        pagesRead: 1,
        gatedRoutes: [collapseDynamic(asked.pathname)],
        refusesFraming: null,
        clientRendered: false,
        more: false,
      },
    };
  }

  const origin = landed.origin;
  const at = (path: string) => origin + path;

  // House rules and a map, if the site publishes them.
  const robotsPage = await fetchPage(at("/robots.txt"), { stayOn: origin });
  const robots = robotsPage && robotsPage.status === 200 && !isHtml(robotsPage) ? parseRobots(robotsPage.body) : { disallow: [], sitemaps: [] };
  const mapped: string[] = [];
  for (const sitemapUrl of (robots.sitemaps.length > 0 ? robots.sitemaps : [at("/sitemap.xml")]).slice(0, 2)) {
    const sitemap = await fetchPage(sitemapUrl, { stayOn: origin });
    if (!sitemap || sitemap.status !== 200) continue;
    for (const match of sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      try {
        const url = new URL(match[1].replace(/&amp;/g, "&"));
        if (url.origin === origin && !url.pathname.endsWith(".xml")) mapped.push(url.pathname + url.search);
      } catch {
        // Not an address.
      }
      if (mapped.length >= 200) break;
    }
  }

  const observations: PageObservation[] = [firstSeen];
  const wentElsewhere: string[] = [];
  // Every path ever queued or landed on, by its collapsed form.
  const known = new Set<string>([collapseDynamic(firstSeen.requestedPath), collapseDynamic(firstSeen.landedPath)]);
  const queue: string[] = [];
  // nextToVisit is the one rule for "new and worth a visit"; robots.txt then has its say.
  const enqueue = (from: PageObservation[]) =>
    queue.push(...nextToVisit(from, known, Number.MAX_SAFE_INTEGER).filter((path) => allowedByRobots(path, robots.disallow)));
  enqueue([firstSeen]);
  // Linked pages first (they are the app's own idea of its screens). The
  // sitemap comes in when the links run dry, as a page that "links" to
  // everything on it.
  const sitemapAsPage: PageObservation = { ...firstSeen, linkedPaths: mapped };
  let mapUsed = false;
  let outOfTime = false;
  // Dead links cost a request and yield no page; the cap keeps a site full of them from running long.
  let attempts = 0;

  while (observations.length < options.budget && attempts < options.budget * 2) {
    if (queue.length === 0 && !mapUsed) {
      mapUsed = true;
      enqueue([sitemapAsPage]);
    }
    if (queue.length === 0) break;
    if (now() - startedAt > options.deadlineMs) {
      outOfTime = true;
      break;
    }
    const batch = queue.splice(0, Math.min(options.concurrency, options.budget - observations.length));
    attempts += batch.length;
    const fetched = await Promise.all(batch.map((path) => fetchPage(at(path), { stayOn: origin })));
    fetched.forEach((page, i) => {
      const path = batch[i];
      if (!page) return;
      if (page.leftSiteFor) {
        wentElsewhere.push(collapseDynamic(path));
        return;
      }
      if (page.status >= 400 || !isHtml(page) || !crawlablePath(new URL(page.url).pathname)) return;
      const seen = observeHtml(page.body, path, page.url);
      observations.push(seen);
      known.add(collapseDynamic(seen.landedPath));
      enqueue([seen]);
    });
  }
  if (!mapUsed) enqueue([sitemapAsPage]);
  const unread = outOfTime || queue.length > 0;

  const gate = detectGate(observations);
  const screens = newScreens(observations, [], gate?.signature ?? null);
  // The gate is a real screen, and on a new canvas nothing has drawn it yet.
  const gatePage = gate && observations.find((o) => o.signature === gate.signature);
  if (gatePage && !screens.some((o) => collapseDynamic(o.landedPath) === collapseDynamic(gatePage.landedPath))) {
    screens.push(gatePage);
  }

  const titles = splitSharedTitle(screens.map((o) => o.title));
  const siteName = first.body.match(/<meta\b[^>]*property\s*=\s*["']og:site_name["'][^>]*>/i)?.[0].match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
  const pages: SiteReading["pages"] = screens.map((o, i) => ({
    path: o.landedPath,
    title: titles.pages[i] || titleFromPath(o.landedPath),
  }));
  sectionByFirstSegment(pages);

  return {
    ok: true,
    site: {
      origin,
      name: (siteName ?? titles.site).trim() || landed.hostname.replace(/^www\./, ""),
      pages,
      pagesRead: observations.length,
      gatedRoutes: [...new Set([...(gate?.gatedRoutes ?? []), ...wentElsewhere])].sort(),
      refusesFraming: framingRefusal(first.headers, options.embedderOrigin),
      clientRendered: looksClientRendered(first.body) && pages.length <= 1,
      more: unread,
    },
  };
}

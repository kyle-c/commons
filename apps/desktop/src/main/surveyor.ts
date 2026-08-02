import { BrowserWindow } from "electron";
import {
  collapseDynamic,
  crawlablePath,
  detectGate,
  newScreens,
  nextToVisit,
  type PageObservation,
} from "./surveyLogic";

/**
 * The runtime survey: drive the app the user actually runs and report what
 * it is, instead of trusting the filesystem's opinion of what it should be.
 *
 * Static discovery reads routers; it cannot see screens declared at runtime,
 * modals, wizard steps, or the login gate an authenticated app collapses
 * into. This walks the real thing in a hidden window — same vehicle as
 * snapshots — visits every known route plus everything the app links to
 * (breadth-first, budgeted), fingerprints each page structurally, and comes
 * back with evidence: screens the canvas is missing, routes that all showed
 * a sign-in form, and screenshots for the review queue.
 *
 * Nothing here writes anywhere. The renderer owns uploading and proposing,
 * because proposals are review-gated exactly like the CI crawl's — a survey
 * is testimony, never truth.
 */

const PAGE_BUDGET = 40;
const SETTLE_MS = 1200;
const VIEWPORT = { width: 1280, height: 800 };

export interface SurveyProgress {
  visited: number;
  total: number;
  current: string;
}

export interface SurveyResult {
  pagesVisited: number;
  gatedRoutes: string[];
  /** Screens the canvas doesn't have, with a capture each. */
  screens: { path: string; title: string; signature: string; png: Uint8Array; width: number; height: number }[];
  unresolvedDynamic: string[];
}

/** What one loaded page looks like, extracted inside the page itself. */
const OBSERVE = `(() => {
  const links = [...document.querySelectorAll("a[href]")]
    .map((a) => { try { const u = new URL(a.href); return u.origin === location.origin ? u.pathname + u.search : null; } catch { return null; } })
    .filter(Boolean);
  const landmarks = [...document.querySelectorAll("main,nav,header,footer,aside,form,h1,h2,table,dialog,[role=dialog]")]
    .slice(0, 40)
    .map((el) => el.tagName + (el.getAttribute("role") ?? ""));
  const textMass = Math.round((document.body.innerText || "").length / 200);
  const inputs = [...document.querySelectorAll("input")].map((i) => i.type);
  return {
    links: [...new Set(links)].slice(0, 60),
    skeleton: landmarks.join(",") + "|" + textMass + "|" + inputs.sort().join(","),
    hasCredentialFields: inputs.includes("password") || (inputs.includes("email") && inputs.length <= 3),
    title: document.title || (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 60),
    path: location.pathname + location.search,
  };
})()`;

function hash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function surveyApp(
  baseUrl: string,
  knownRoutes: { path: string; dynamic: boolean }[],
  onProgress?: (p: SurveyProgress) => void
): Promise<SurveyResult> {
  const base = baseUrl.replace(/\/+$/, "");
  const startPaths = knownRoutes.filter((r) => !r.dynamic && crawlablePath(r.path)).map((r) => r.path);
  const unresolvedDynamic = knownRoutes.filter((r) => r.dynamic).map((r) => r.path);
  if (startPaths.length === 0) startPaths.push("/");

  const win = new BrowserWindow({
    show: false,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    webPreferences: { offscreen: true, sandbox: true },
  });

  const observations: PageObservation[] = [];
  const captures = new Map<string, Uint8Array>();
  const visited = new Set<string>(startPaths.map(collapseDynamic));
  let queue = [...startPaths];

  try {
    while (queue.length > 0 && observations.length < PAGE_BUDGET) {
      const path = queue.shift()!;
      onProgress?.({ visited: observations.length, total: Math.min(PAGE_BUDGET, observations.length + queue.length + 1), current: path });
      try {
        await win.loadURL(`${base}${path}`);
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        const raw = (await win.webContents.executeJavaScript(OBSERVE, true)) as {
          links: string[];
          skeleton: string;
          hasCredentialFields: boolean;
          title: string;
          path: string;
        };
        const observation: PageObservation = {
          requestedPath: path,
          landedPath: raw.path,
          signature: hash(raw.skeleton),
          hasCredentialFields: raw.hasCredentialFields,
          title: raw.title,
          linkedPaths: raw.links,
        };
        observations.push(observation);
        const image = await win.webContents.capturePage();
        captures.set(observation.signature + collapseDynamic(observation.landedPath), new Uint8Array(image.toPNG()));
      } catch {
        // A route that won't load is a fact, not a crash — move on.
      }
      if (queue.length === 0) {
        queue = nextToVisit(observations, visited, PAGE_BUDGET - observations.length);
      }
    }
  } finally {
    win.destroy();
  }

  const gate = detectGate(observations);
  const fresh = newScreens(
    observations,
    knownRoutes.map((r) => r.path),
    gate?.signature ?? null
  );

  return {
    pagesVisited: observations.length,
    gatedRoutes: gate?.gatedRoutes ?? [],
    screens: fresh.map((o) => ({
      path: collapseDynamic(o.landedPath),
      title: o.title || collapseDynamic(o.landedPath),
      signature: o.signature,
      png: captures.get(o.signature + collapseDynamic(o.landedPath)) ?? new Uint8Array(),
      width: VIEWPORT.width,
      height: VIEWPORT.height,
    })),
    unresolvedDynamic,
  };
}

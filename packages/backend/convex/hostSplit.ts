/**
 * The origin split: which host serves what. Pure, so the rule is testable on
 * its own; http.ts asks it before serving a page.
 *
 * The browser app keeps the signed-in session in localStorage on its own
 * origin, and a Commons-hosted preview is active content written by whoever
 * can get a build to run. Served from one origin, a preview's script reads
 * the token and is the user. So they get one host each:
 *
 * - The app host (PUBLIC_SITE_URL, the branded domain) serves the app and
 *   every page that lives with a session or a share token.
 * - The preview host (the deployment's own .convex.site, or PREVIEW_SITE_URL)
 *   serves previews and nothing a person signs in to.
 *
 * A request for one side that arrives on the other host is sent across
 * rather than answered. Where the two are the same host (dev, a deployment
 * with no branded domain) there is nothing to separate with, and everything
 * is served together as it always was.
 *
 * What this does not do: previews still share the preview host with each
 * other. Giving every preview an origin of its own takes a wildcard domain.
 */

import { SESSION_STORAGE_KEY } from "@commons/shared";

/** Which side of the split a route belongs to. */
export type Side = "app" | "preview";

export type SplitVerdict =
  | { serve: true }
  /** Not here: the same path and query on the host this side lives on. */
  | { serve: false; location: string };

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Whether there are two hosts to keep apart at all. */
export function isSplit(appSite: string, previewSite: string): boolean {
  const app = hostOf(appSite);
  const preview = hostOf(previewSite);
  return app !== null && preview !== null && app !== preview;
}

/**
 * Previews fail closed: they are served on the preview host and nowhere
 * else, whatever the other host is called. App pages fail open: the preview
 * host is the one place they are refused, so an alias of the app's domain
 * keeps working.
 */
export function splitVerdict(side: Side, requestUrl: string, appSite: string, previewSite: string): SplitVerdict {
  if (!isSplit(appSite, previewSite)) return { serve: true };
  const request = new URL(requestUrl);
  const onPreviewHost = request.host === hostOf(previewSite);
  if (side === "preview") {
    return onPreviewHost ? { serve: true } : { serve: false, location: previewSite + request.pathname + request.search };
  }
  return onPreviewHost ? { serve: false, location: appSite + request.pathname + request.search } : { serve: true };
}

/**
 * Forget a session left on this origin. Before the split the app ran on the
 * preview host too, and sessions do not expire, so a browser that signed in
 * there still holds a working token where previews can read it. The app
 * never runs on this origin again, which leaves script served from it as the
 * only thing that can clear the key.
 */
const FORGET_SESSION = `try{localStorage.removeItem(${JSON.stringify(SESSION_STORAGE_KEY)})}catch(e){}`;

/**
 * A preview's HTML shell with the forgetting done first: the script goes
 * straight after the doctype (so the page keeps its rendering mode), ahead of
 * anything the build put there, including a meta policy that would block it.
 */
export function armorPreviewShell(html: string): string {
  const lead = html.match(/^(?:﻿|\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i);
  const at = lead ? lead[0].length : 0;
  return `${html.slice(0, at)}<script>${FORGET_SESSION}</script>${html.slice(at)}`;
}

/**
 * What the preview host answers where the app used to be: forget the session
 * kept here, then go to where the app lives, keeping the hash route.
 */
export function movedAppPage(location: string): string {
  const inScript = JSON.stringify(location).replace(/</g, "\\u003c");
  const inAttribute = location.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return (
    `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Commons</title>` +
    `<script>${FORGET_SESSION}location.replace(${inScript}+location.hash)</script>` +
    `<noscript><a href="${inAttribute}">Commons lives here now</a></noscript>`
  );
}

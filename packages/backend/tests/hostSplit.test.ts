import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { armorPreviewShell, isSplit, movedAppPage, splitVerdict } from "../convex/hostSplit";

/**
 * The split is the fix for the one critical finding of the 2026-08-08
 * security review: preview HTML sharing an origin with the web app's session.
 * These pin the rule itself. That each route asks the rule is checked against
 * the source in the last block.
 */

const APP = "https://www.trycommons.app";
const PREVIEW = "https://rapid-anteater-106.convex.site";

describe("origin split", () => {
  it("serves previews on the preview host and sends them there from anywhere else", () => {
    expect(splitVerdict("preview", `${PREVIEW}/preview/tok/main/`, APP, PREVIEW)).toEqual({ serve: true });
    expect(splitVerdict("preview", `${APP}/preview/tok/main/settings?tab=2`, APP, PREVIEW)).toEqual({
      serve: false,
      location: `${PREVIEW}/preview/tok/main/settings?tab=2`,
    });
    // An alias of the app's domain, or a host nobody planned for, is still not the preview host.
    for (const host of ["https://trycommons.app", "https://www.trycommons.app.", "https://evil.example"]) {
      const verdict = splitVerdict("preview", `${host}/preview/tok/main/`, APP, PREVIEW);
      expect(verdict, host).toEqual({ serve: false, location: `${PREVIEW}/preview/tok/main/` });
    }
  });

  it("refuses app pages on the preview host and nowhere else", () => {
    expect(splitVerdict("app", `${APP}/app`, APP, PREVIEW)).toEqual({ serve: true });
    expect(splitVerdict("app", "https://trycommons.app/app", APP, PREVIEW)).toEqual({ serve: true });
    expect(splitVerdict("app", `${PREVIEW}/app/assets/index.js?v=3`, APP, PREVIEW)).toEqual({
      serve: false,
      location: `${APP}/app/assets/index.js?v=3`,
    });
    expect(splitVerdict("app", `${PREVIEW}/t/abc`, APP, PREVIEW)).toEqual({ serve: false, location: `${APP}/t/abc` });
  });

  it("matches hosts the way browsers do", () => {
    expect(splitVerdict("preview", "https://RAPID-ANTEATER-106.convex.site/preview/t/main/", APP, PREVIEW)).toEqual({ serve: true });
    // A port makes a different origin.
    expect(splitVerdict("preview", `${PREVIEW}:8443/preview/t/main/`, APP, PREVIEW).serve).toBe(false);
  });

  it("serves everything together when there is one host", () => {
    const one = "https://basic-raven-343.convex.site";
    expect(isSplit(one, one)).toBe(false);
    expect(splitVerdict("preview", `${one}/preview/t/main/`, one, one)).toEqual({ serve: true });
    expect(splitVerdict("app", `${one}/app`, one, one)).toEqual({ serve: true });
    // Unset or unreadable configuration is one host too, not an error page.
    expect(splitVerdict("app", `${one}/app`, "", one)).toEqual({ serve: true });
    expect(splitVerdict("preview", `${one}/preview/t/main/`, one, "nonsense")).toEqual({ serve: true });
    expect(isSplit(APP, PREVIEW)).toBe(true);
  });

  it("never bounces a request between the two hosts", () => {
    for (const side of ["app", "preview"] as const) {
      for (const start of [`${APP}/x?y=1`, `${PREVIEW}/x?y=1`]) {
        const first = splitVerdict(side, start, APP, PREVIEW);
        if (first.serve) continue;
        expect(splitVerdict(side, first.location, APP, PREVIEW), `${side} from ${start}`).toEqual({ serve: true });
      }
    }
  });
});

describe("preview shell", () => {
  const FORGET = `<script>try{localStorage.removeItem("commons.session")}catch(e){}</script>`;

  it("forgets a leftover session before anything in the build runs", () => {
    const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><script src="/app.js"></script></head></html>`;
    const armored = armorPreviewShell(html);
    expect(armored.startsWith(`<!doctype html>${FORGET}<html>`)).toBe(true);
    expect(armored.indexOf(FORGET)).toBeLessThan(armored.indexOf("Content-Security-Policy"));
    expect(armored.replace(FORGET, "")).toBe(html);
  });

  it("keeps the doctype first, so the page keeps its rendering mode", () => {
    expect(armorPreviewShell(`﻿\n<!-- built by vite -->\n<!DOCTYPE html>\n<html></html>`)).toBe(
      `﻿\n<!-- built by vite -->\n<!DOCTYPE html>${FORGET}\n<html></html>`
    );
  });

  it("goes first when there is no doctype to follow, and on an empty shell", () => {
    expect(armorPreviewShell("<html><body>x</body></html>")).toBe(`${FORGET}<html><body>x</body></html>`);
    expect(armorPreviewShell("")).toBe(FORGET);
    // A doctype that is not at the start is content, not a preamble.
    expect(armorPreviewShell("<p><!doctype html>").startsWith(FORGET)).toBe(true);
  });
});

describe("the page left where the app used to be", () => {
  it("forgets the session, then goes to the app with the hash route", () => {
    const page = movedAppPage(`${APP}/app?x=1`);
    expect(page).toContain(`localStorage.removeItem("commons.session")`);
    expect(page).toContain(`location.replace("${APP}/app?x=1"+location.hash)`);
    expect(page.indexOf("removeItem")).toBeLessThan(page.indexOf("location.replace"));
  });

  it("cannot be broken out of by the address it carries", () => {
    const page = movedAppPage(`${APP}/app?q=</script><script>alert(1)</script>&r="onx="`);
    expect(page.match(/<script>/g)?.length).toBe(1);
    expect(page).not.toContain(`r="onx="`);
    expect(() => new Function(page.match(/<script>([\s\S]*?)<\/script>/)![1])).not.toThrow();
  });
});

/**
 * The rule only protects the routes that ask it. Every GET route in http.ts
 * either asks before it touches anything, or is listed here with the reason
 * it answers on both hosts. A new page that forgets fails this test, not a
 * security review.
 */
describe("every page asks the rule", () => {
  // Fetched by machines or included by other sites: no session, no storage,
  // nothing that runs on our origin.
  const EITHER_HOST: Record<string, string> = {
    "/og.jpg": "the share card image",
    "/download": "redirects to the current disk image",
    "/update/": "the desktop app's update feed and artifacts",
    "/setup/commons-agent.yml": "the workflow file CI setup copies",
    "/setup/flow-crawler.mjs": "fetched by the crawl in the customer's CI",
    "/setup/agent-runner.mjs": "fetched by the agent run in the customer's CI",
    "/intercept.js": "a script other sites include; it runs on their origin",
    "/commons-testing.js": "a script the app under test includes; it runs on its origin",
  };
  const PREVIEW_SIDE = ["/preview/"];

  const source = readFileSync(new URL("../convex/http.ts", import.meta.url), "utf8");
  const routes = source
    .split("http.route({")
    .slice(1)
    .map((chunk) => ({
      path: chunk.match(/^\s*(?:path|pathPrefix): "([^"]+)"/)?.[1] ?? "?",
      method: chunk.match(/method: "([A-Z]+)"/)?.[1] ?? "?",
      // Up to the end of this route's handler, which is where the next route or a helper begins.
      body: chunk.split(/\n}\);\n/)[0],
    }))
    .filter((route) => route.method === "GET");

  it("finds the routes it is meant to check", () => {
    expect(routes.length).toBeGreaterThanOrEqual(19);
    expect(routes.map((r) => r.path)).toContain("/app");
    expect(routes.map((r) => r.path)).toContain("/preview/");
  });

  it.each(routes.map((route) => [route.path, route] as const))("%s", (path, route) => {
    const gate = route.body.match(/(?:elsewhere\("(app|preview)", request\)|(appElsewhere)\(request\))/);
    if (path in EITHER_HOST) {
      expect(gate, `${path} is listed as answering on either host but asks the rule`).toBeNull();
      return;
    }
    expect(gate, `${path} serves a page without asking which host it is on`).not.toBeNull();
    const side = gate![2] ? "app" : gate![1];
    expect(side, `${path} is on the wrong side of the split`).toBe(PREVIEW_SIDE.includes(path) ? "preview" : "app");
    // Asked first: before the handler reads a token from the address or touches the database.
    const firstUse = route.body.search(/ctx\.run|new URL\(request\.url\)/);
    expect(route.body.indexOf(gate![0]), `${path} asks too late`).toBeLessThan(firstUse === -1 ? Infinity : firstUse);
  });

  it("keeps the app itself off the preview host with the page that forgets the session", () => {
    for (const path of ["/app", "/app/"]) {
      expect(routes.find((r) => r.path === path)!.body).toContain("appElsewhere(request)");
    }
  });
});

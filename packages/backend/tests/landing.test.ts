import { describe, expect, it } from "vitest";
import { landingHtml } from "../convex/landing";

/**
 * trycommons.app is one template literal, so the compiler sees a string: a
 * broken share tag, a leaked interpolation, or a script the template quietly
 * mangled would all type-check and ship. These read the rendered page.
 */

const SITE = "https://www.trycommons.app";
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 27, 18, 0, 0); // Sep 27, 2026, 18:00 UTC

const render = (over: Partial<Parameters<typeof landingHtml>[0]> = {}) =>
  landingHtml({ version: "0.2.154", releasedAt: NOW - 2 * 3_600_000, site: SITE, now: NOW, ...over });

describe("landing page", () => {
  it("points canonical and share tags at the public origin", () => {
    const html = render({ site: SITE + "/" });
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}/" />`);
    expect(html).toContain(`<meta property="og:image" content="${SITE}/og.jpg" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${SITE}/og.jpg" />`);
    expect(html).toMatch(/og:image:width" content="1200"/);
  });

  it("leaks nothing from the template", () => {
    for (const html of [render(), landingHtml({ site: SITE, now: NOW })]) {
      expect(html).not.toMatch(/\$\{|undefined|NaN|\[object/);
      expect(html, "em dashes are out of house style").not.toContain("\u2014");
    }
  });

  it("says when the current build shipped, and nothing when there isn't one", () => {
    expect(render()).toMatch(/<span>Version 0\.2\.154, shipped <span id="shipped" data-at="\d+">today<\/span>\.<\/span>/);
    expect(render({ releasedAt: NOW - DAY })).toContain(">yesterday</span>");
    expect(render({ releasedAt: Date.UTC(2026, 8, 11, 12) })).toContain(">on Sep 11</span>");
    expect(landingHtml({ site: SITE, now: NOW })).not.toContain('class="shipped"');
  });

  it("uses real headings for every section title", () => {
    const html = render();
    expect(html).not.toContain('class="h3"');
    expect((html.match(/<h3>/g) ?? []).length).toBeGreaterThanOrEqual(9);
    expect((html.match(/<h1>/g) ?? []).length).toBe(1);
  });

  it("subsets the handwriting font to every character it has to draw", () => {
    const html = render();
    const param = html.match(/family=Shantell\+Sans[^"]*&text=([^"&]+)/);
    expect(param, "Shantell Sans should be requested with a text= subset").not.toBeNull();
    const glyphs = new Set(decodeURIComponent(param![1]));
    const handSet = [
      html.match(/<div class="note-y">([^<]+)<\/div>/)?.[1],
      html.match(/<span class="dock-hint"[^>]*>([^<]+)<\/span>/)?.[1],
      html.match(/<p class="turn"[^>]*>([^<]+)<\/p>/)?.[1],
    ];
    for (const text of handSet) {
      expect(text, "a hand-set string went missing").toBeTruthy();
      for (const ch of text!) expect(glyphs.has(ch), `"${ch}" is set in the marker hand but not in the subset`).toBe(true);
    }
  });

  it("ships an inline script that still compiles after the template has had its way", () => {
    const html = render();
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBe(1);
    // Compiles without running: catches a backslash or quote the template ate.
    expect(() => new Function(scripts[0])).not.toThrow();
    // A var sharing a function's name overwrites it at runtime (hoisting), so
    // the script compiles and then dies on first call. It happened once.
    const fns = [...scripts[0].matchAll(/function ([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
    for (const name of fns) {
      expect(scripts[0], `a var or let named "${name}" shadows the function ${name}()`).not.toMatch(
        new RegExp(`\\b(?:var|let|const) ${name}\\b`)
      );
    }
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    expect(() => JSON.parse(ld ?? "")).not.toThrow();
  });

  it("counts only the events the beacon accepts", async () => {
    const { LANDING_EVENTS } = await import("../convex/landingEvents");
    const html = render();
    const sent = new Set([...html.matchAll(/count\("([a-z_]+)"\)/g)].map((m) => m[1]));
    for (const e of sent) expect(LANDING_EVENTS as readonly string[], `page sends "${e}", beacon drops it`).toContain(e);
    for (const e of LANDING_EVENTS) expect(sent, `nothing on the page sends "${e}"`).toContain(e);
  });
});

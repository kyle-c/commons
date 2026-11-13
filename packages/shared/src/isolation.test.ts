import { describe, expect, it } from "vitest";
import { frameSandbox, isWebUrl, SESSION_STORAGE_KEY } from "./isolation";

const APP = "https://www.trycommons.app";

describe("frame sandbox", () => {
  it("lets someone else's app keep its own origin and work like an app", () => {
    for (const url of [
      "https://rapid-anteater-106.convex.site/preview/abc/main/",
      "https://staging.example.com/settings",
      "http://localhost:4310/",
    ]) {
      const tokens = frameSandbox(url, APP).split(" ");
      expect(tokens).toContain("allow-scripts");
      expect(tokens).toContain("allow-same-origin");
      expect(tokens).toContain("allow-forms");
      expect(tokens).toContain("allow-popups");
    }
  });

  it("never lets a frame take over the tab it is shown in", () => {
    for (const url of ["https://staging.example.com/", `${APP}/preview/abc/main/`, "not a url"]) {
      expect(frameSandbox(url, APP)).not.toMatch(/allow-top-navigation/);
    }
  });

  it("withholds our origin from anything addressed on it", () => {
    for (const url of [`${APP}/preview/abc/main/`, `${APP}/app`, "/preview/abc/main/", `${APP.toUpperCase()}/x`]) {
      const tokens = frameSandbox(url, APP).split(" ");
      expect(tokens, url).not.toContain("allow-same-origin");
      // A window it opens stays sandboxed too, or opening itself would be the way back in.
      expect(tokens, url).not.toContain("allow-popups-to-escape-sandbox");
      expect(tokens, url).toContain("allow-scripts");
    }
  });

  it("is strict when it cannot tell", () => {
    expect(frameSandbox("::::", APP).split(" ")).not.toContain("allow-same-origin");
    // The desktop app's own page has no origin ("null"); a relative address there is unreadable.
    expect(frameSandbox("/x", "null").split(" ")).not.toContain("allow-same-origin");
  });

  it("treats a different port or scheme as someone else", () => {
    // The desktop app in development: the renderer on one port, the user's dev server on another.
    expect(frameSandbox("http://localhost:4310/", "http://localhost:5173").split(" ")).toContain("allow-same-origin");
    expect(frameSandbox("http://www.trycommons.app/", APP).split(" ")).toContain("allow-same-origin");
    expect(frameSandbox("http://localhost:4310/", "null").split(" ")).toContain("allow-same-origin");
  });

  it("names the session key the renderer stores under", () => {
    expect(SESSION_STORAGE_KEY).toBe("commons.session");
  });
});

describe("web addresses", () => {
  // Each of these, saved as a project's preview URL, ran inside the app until
  // 2026-11-13: the canvas framed whatever was stored.
  const SCRIPTS = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "javascript:void(top.postMessage(top.localStorage.getItem('commons.session'),'*'))//x/",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://www.trycommons.app/5b0c9f2e",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "about:blank",
  ];

  it("are http and https, and nothing else", () => {
    for (const url of ["https://staging.example.com/x", "http://localhost:4310/", "HTTPS://EXAMPLE.COM"]) expect(isWebUrl(url), url).toBe(true);
    for (const url of [...SCRIPTS, "", "/relative/path", "example.com", "//example.com/x", "ftp://example.com"]) {
      expect(isWebUrl(url), JSON.stringify(url)).toBe(false);
    }
  });

  it("never get our origin when they are not web addresses", () => {
    // A script address runs as the page that frames it. The frame component
    // refuses these outright; the sandbox is strict as well, so neither one
    // is the only thing in the way.
    for (const url of SCRIPTS) {
      const tokens = frameSandbox(url, "https://www.trycommons.app").split(" ");
      expect(tokens, url).not.toContain("allow-same-origin");
      expect(tokens, url).not.toContain("allow-popups-to-escape-sandbox");
    }
    expect(frameSandbox("javascript:alert(1)", "null").split(" ")).not.toContain("allow-same-origin");
  });
});

import { describe, expect, it } from "vitest";
import { frameSandbox, SESSION_STORAGE_KEY } from "./isolation";

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

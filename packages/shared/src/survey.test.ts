import { describe, expect, it } from "vitest";
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
} from "./survey";

const page = (body: string, title = "Page") =>
  `<!doctype html><html><head><title>${title}</title><style>a{color:red}</style></head><body>${body}</body></html>`;

const seen = (over: Partial<PageObservation>): PageObservation => ({
  requestedPath: "/",
  landedPath: "/",
  signature: "s",
  hasCredentialFields: false,
  title: "",
  linkedPaths: [],
  ...over,
});

describe("survey rules", () => {
  it("visits pages, not assets or endpoints", () => {
    for (const path of ["/", "/settings/profile", "/posts/42?tab=1"]) expect(crawlablePath(path), path).toBe(true);
    for (const path of ["/logo.svg", "/app.js", "/api/users", "/_next/static/x", "mailto:a@b.c", "settings", "/doc.pdf?x=1"]) {
      expect(crawlablePath(path), path).toBe(false);
    }
  });

  it("counts /posts/42 and /posts/7 as one screen", () => {
    expect(collapseDynamic("/posts/42")).toBe("/posts/[param]");
    expect(collapseDynamic("/posts/7?ref=home")).toBe("/posts/[param]");
    expect(collapseDynamic("/u/3f2b8c1e-9a4d-4e21-b7aa-1c2d3e4f5a6b/edit")).toBe("/u/[param]/edit");
    expect(collapseDynamic("/pricing")).toBe("/pricing");
  });

  it("finds the sign-in gate from evidence: many routes, one shape, and it asks for credentials", () => {
    const login = { signature: "login", hasCredentialFields: true, landedPath: "/login" };
    const gate = detectGate([
      seen({ requestedPath: "/dashboard", ...login }),
      seen({ requestedPath: "/settings", ...login }),
      seen({ requestedPath: "/billing", ...login }),
      seen({ requestedPath: "/", signature: "home" }),
    ]);
    expect(gate).toEqual({ signature: "login", gatedRoutes: ["/billing", "/dashboard", "/settings"] });
    // Two routes sharing a shape is a coincidence, and a shared shape with no credentials is a template.
    expect(detectGate([seen({ requestedPath: "/a", ...login }), seen({ requestedPath: "/b", ...login })])).toBeNull();
    expect(detectGate(["/a", "/b", "/c"].map((p) => seen({ requestedPath: p, signature: "same" })))).toBeNull();
  });

  it("proposes each new screen once, and never the gate", () => {
    const fresh = newScreens(
      [
        seen({ landedPath: "/", signature: "home" }),
        seen({ landedPath: "/posts/1", signature: "post" }),
        seen({ landedPath: "/posts/2", signature: "post" }),
        seen({ landedPath: "/login", signature: "login" }),
        seen({ landedPath: "/pricing", signature: "pricing" }),
      ],
      ["/pricing"],
      "login"
    );
    expect(fresh.map((o) => o.landedPath)).toEqual(["/", "/posts/1"]);
  });

  it("queues what pages link to, once each, up to the budget", () => {
    const visited = new Set(["/"]);
    const next = nextToVisit(
      [seen({ linkedPaths: ["/a", "/a#top", "/posts/1", "/posts/2", "/logo.png", "/", "/b", "/users/[id]"] })],
      visited,
      3
    );
    expect(next).toEqual(["/a", "/posts/1", "/b"]);
    expect(nextToVisit([seen({ linkedPaths: ["/a", "/c"] })], visited, 5)).toEqual(["/c"]);
  });

  it("groups routes by a first segment two or more share", () => {
    const routes: { path: string; section?: string }[] = [
      { path: "/" },
      { path: "/settings/profile" },
      { path: "/settings/billing?tab=1" },
      { path: "/pricing" },
      { path: "/team-admin/users", section: "Admin" },
      { path: "/user_guides/a" },
      { path: "/user_guides/b" },
    ];
    sectionByFirstSegment(routes);
    expect(routes.map((r) => r.section)).toEqual([undefined, "Settings", "Settings", undefined, "Admin", "User Guides", "User Guides"]);
  });
});

describe("reading a page from its HTML", () => {
  const landed = "https://app.example.com/docs/intro?x=1";

  it("reports where the request landed, not where it was sent", () => {
    const o = observeHtml(page("<h1>Intro</h1>"), "/docs", landed);
    expect(o.requestedPath).toBe("/docs");
    expect(o.landedPath).toBe("/docs/intro?x=1");
  });

  it("collects the app's own links, however they are written", () => {
    const o = observeHtml(
      page(`
        <a href="/pricing">Pricing</a>
        <a class="x" href='guide?step=2&amp;lang=en'>Guide</a>
        <a href=/about>About</a>
        <a href="https://app.example.com/team">Team</a>
        <a href="https://other.example.com/away">Away</a>
        <a href="mailto:hi@example.com">Mail</a>
        <a href="#top">Top</a>
        <a>No address</a>
        <script>document.write('<a href="/from-script">x</a>')</script>
        <!-- <a href="/commented-out">x</a> -->
      `),
      "/docs/intro",
      landed
    );
    expect(o.linkedPaths).toEqual(["/pricing", "/docs/guide?step=2&lang=en", "/about", "/team", "/docs/intro?x=1"]);
  });

  it("recognizes a sign-in form", () => {
    const login = observeHtml(page(`<form><input type="email"><input type=password><button>Sign in</button></form>`), "/app", landed);
    expect(login.hasCredentialFields).toBe(true);
    const magicLink = observeHtml(page(`<form><input type="email" name="e"></form>`), "/app", landed);
    expect(magicLink.hasCredentialFields).toBe(true);
    const signup = observeHtml(page(`<form><input><input><input><input type="email"></form>`), "/join", landed);
    expect(signup.hasCredentialFields).toBe(false);
  });

  it("gives pages of one shape one signature, and a different shape another", () => {
    const article = (words: number) => page(`<header><nav></nav></header><main><h1>T</h1>${"word ".repeat(words)}</main><footer></footer>`);
    const a = observeHtml(article(100), "/a", landed).signature;
    expect(observeHtml(article(104), "/b", landed).signature).toBe(a);
    expect(observeHtml(article(900), "/c", landed).signature).not.toBe(a);
    expect(observeHtml(page("<main><form><input type=password></form></main>"), "/d", landed).signature).not.toBe(a);
  });

  it("takes the title from the title tag, else the first heading", () => {
    expect(observeHtml(page("<h1>Heading</h1>", "Pricing &amp; plans | Acme"), "/", landed).title).toBe("Pricing & plans | Acme");
    expect(observeHtml("<html><body><h1> Hello <em>there</em> </h1></body></html>", "/", landed).title).toBe("Hello there");
    expect(observeHtml("<html><body></body></html>", "/", landed).title).toBe("");
  });

  it("knows an empty shell when it reads one", () => {
    const shell = `<!doctype html><html><head><title>App</title><script type="module" src="/assets/index.js"></script></head><body><div id="root"></div><noscript>You need JavaScript</noscript></body></html>`;
    expect(looksClientRendered(shell)).toBe(true);
    expect(looksClientRendered(page(`<nav><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></nav><main>${"Real words. ".repeat(40)}</main><script src="/x.js"></script>`))).toBe(false);
    // No scripts at all is a plain page, however short.
    expect(looksClientRendered("<html><body><p>Hi</p></body></html>")).toBe(false);
  });
});

describe("page titles", () => {
  it("drops the part every page shares and hands it back as the site's name", () => {
    expect(splitSharedTitle(["Acme", "Pricing | Acme", "Docs | Acme", "Sign in | Acme"])).toEqual({
      site: "Acme",
      pages: ["", "Pricing", "Docs", "Sign in"],
    });
    expect(splitSharedTitle(["Acme - Home", "Acme - Pricing"])).toEqual({ site: "Acme", pages: ["Home", "Pricing"] });
    expect(splitSharedTitle(["Acme · Team", "Acme · Billing settings"]).pages).toEqual(["Team", "Billing settings"]);
  });

  it("leaves titles alone when nothing is shared", () => {
    expect(splitSharedTitle(["Pricing", "Docs", "Team"])).toEqual({ site: "", pages: ["Pricing", "Docs", "Team"] });
    expect(splitSharedTitle(["Only page | Acme"])).toEqual({ site: "", pages: ["Only page | Acme"] });
    expect(splitSharedTitle([])).toEqual({ site: "", pages: [] });
  });

  it("keeps hyphenated words whole", () => {
    expect(splitSharedTitle(["Sign-in | Acme", "Add-ons | Acme"]).pages).toEqual(["Sign-in", "Add-ons"]);
  });
});

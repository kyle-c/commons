import { describe, expect, it } from "vitest";
import { framingRefusal, parseRobots, readSite, type Fetched, type FetchPage } from "../convex/siteReader";

/**
 * A made-up site, served from a table. The reader is handed a fetcher, so
 * everything it decides (what is a screen, what is gated, when to stop) can be
 * pinned without a network.
 */

const APP = "https://www.trycommons.app";
const OPTIONS = { budget: 24, concurrency: 4, deadlineMs: 40_000, embedderOrigin: APP };

type Route = string | { redirect: string } | { status: number } | { body: string; type?: string; headers?: Record<string, string> };

function site(origin: string, routes: Record<string, Route>) {
  const requested: string[] = [];
  const fetchPage: FetchPage = async (url, { stayOn }) => {
    let current = new URL(url);
    for (let hop = 0; hop < 5; hop++) {
      if (current.origin !== origin && !routes[current.href]) return null;
      requested.push(current.origin === origin ? current.pathname + current.search : current.href);
      const route = routes[current.origin === origin ? current.pathname + current.search : current.href];
      if (route === undefined) return page(current.href, { status: 404 });
      if (typeof route === "object" && "redirect" in route) {
        const next = new URL(route.redirect, current);
        if (stayOn && next.origin !== stayOn) return { ...page(current.href, { status: 302 }), leftSiteFor: next.host };
        current = next;
        continue;
      }
      return page(current.href, route);
    }
    return null;
  };
  return { fetchPage, requested };
}

function page(url: string, route: Exclude<Route, { redirect: string }>): Fetched {
  if (typeof route === "string") return { url, status: 200, contentType: "text/html; charset=utf-8", headers: {}, body: route };
  if ("status" in route) return { url, status: route.status, contentType: "text/html", headers: {}, body: "" };
  return { url, status: 200, contentType: route.type ?? "text/html", headers: route.headers ?? {}, body: route.body };
}

const html = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const nav = `<nav><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/docs/intro">Docs</a><a href="/docs/api">API</a><a href="/app">Open app</a></nav>`;
const words = (n: number) => `<p>${"word ".repeat(n)}</p>`;
const loginForm = `<main><h1>Sign in</h1><form><input type="email"><input type="password"><button>Go</button></form></main>`;

const O = "https://acme.example.com";

async function read(routes: Record<string, Route>, start = O + "/", options = OPTIONS) {
  const made = site(O, routes);
  const result = await readSite(start, made.fetchPage, options);
  if (!result.ok) throw new Error(result.reason);
  return { ...result.site, requested: made.requested };
}

describe("reading a site from its address", () => {
  const marketing: Record<string, Route> = {
    "/": html("Acme", `${nav}<main><h1>Acme</h1>${words(300)}</main>`),
    "/pricing": html("Pricing | Acme", `${nav}<main><h1>Pricing</h1><table></table>${words(120)}</main>`),
    "/docs/intro": html("Intro | Acme", `${nav}<aside></aside><main><h1>Intro</h1>${words(700)}</main>`),
    "/docs/api": html("API | Acme", `${nav}<aside></aside><main><h1>API</h1><h2>Auth</h2>${words(1500)}</main>`),
    "/app": { redirect: "/login" },
    "/login": html("Sign in | Acme", loginForm),
  };

  it("lays out the pages a site links to, named and grouped as people would", async () => {
    const site = await read(marketing);
    expect(site.origin).toBe(O);
    expect(site.name).toBe("Acme");
    expect(site.pages).toEqual([
      { path: "/", title: "Home" },
      { path: "/pricing", title: "Pricing" },
      { path: "/docs/intro", title: "Intro", section: "Docs" },
      { path: "/docs/api", title: "API", section: "Docs" },
      { path: "/login", title: "Sign in" },
    ]);
    expect(site.gatedRoutes).toEqual([]);
    expect(site.refusesFraming).toBeNull();
    expect(site.clientRendered).toBe(false);
    expect(site.more).toBe(false);
  });

  it("reads each page once", async () => {
    const site = await read(marketing);
    const pages = site.requested.filter((p) => !p.endsWith(".txt") && !p.endsWith(".xml"));
    expect(pages.sort()).toEqual(["/", "/app", "/docs/api", "/docs/intro", "/login", "/pricing"]);
  });

  it("names the sign-in gate once and lists what is behind it", async () => {
    const gatedApp: Record<string, Route> = {
      "/": html("Acme", `<nav><a href="/dashboard">Dashboard</a><a href="/settings">Settings</a><a href="/billing">Billing</a><a href="/about">About</a></nav><main>${words(200)}</main>`),
      "/about": html("About | Acme", `<main><h1>About</h1>${words(400)}</main>`),
      "/dashboard": { redirect: "/login?next=/dashboard" },
      "/settings": { redirect: "/login?next=/settings" },
      "/billing": { redirect: "/login?next=/billing" },
      "/login?next=/dashboard": html("Sign in | Acme", loginForm),
      "/login?next=/settings": html("Sign in | Acme", loginForm),
      "/login?next=/billing": html("Sign in | Acme", loginForm),
    };
    const site = await read(gatedApp);
    expect(site.gatedRoutes).toEqual(["/billing", "/dashboard", "/settings"]);
    expect(site.pages.map((p) => p.title)).toEqual(["Home", "About", "Sign in"]);
    expect(site.pages.filter((p) => p.path.startsWith("/login"))).toHaveLength(1);
  });

  it("counts routes that send you to another host to sign in as gated, without following", async () => {
    const site = await read({
      "/": html("Acme", `<a href="/account">Account</a><a href="/help">Help</a><main>${words(200)}</main>`),
      "/help": html("Help", `<main><h1>Help</h1>${words(500)}</main>`),
      "/account": { redirect: "https://login.idp.example.net/authorize?client=acme" },
    });
    expect(site.gatedRoutes).toEqual(["/account"]);
    expect(site.requested.some((p) => p.includes("idp.example.net"))).toBe(false);
  });

  it("treats /posts/1 and /posts/2 as one screen and reads only one of them", async () => {
    const post = (n: number) => html(`Post ${n}`, `<main><h1>Post</h1>${words(600)}</main>`);
    const site = await read({
      "/": html("Blog", `<a href="/posts/1">1</a><a href="/posts/2">2</a><a href="/posts/3">3</a><main>${words(100)}</main>`),
      "/posts/1": post(1),
      "/posts/2": post(2),
      "/posts/3": post(3),
    });
    expect(site.pages.map((p) => p.path)).toEqual(["/", "/posts/1"]);
    expect(site.requested.filter((p) => p.startsWith("/posts/"))).toEqual(["/posts/1"]);
  });

  it("stops at the budget and says there was more", async () => {
    const routes: Record<string, Route> = { "/": html("Big", Array.from({ length: 30 }, (_, i) => `<a href="/p${i}x">p</a>`).join("") + `<main>${words(50)}</main>`) };
    for (let i = 0; i < 30; i++) routes[`/p${i}x`] = html(`P${i}`, `<main><h1>P</h1>${words(100 + i * 250)}</main>`);
    const site = await read(routes, O + "/", { ...OPTIONS, budget: 8 });
    expect(site.pagesRead).toBe(8);
    expect(site.pages).toHaveLength(8);
    expect(site.more).toBe(true);
  });

  it("gives up on a site of dead links instead of trying them all", async () => {
    const dead = Array.from({ length: 200 }, (_, i) => `<a href="/gone${i}x">x</a>`).join("");
    const site = await read({ "/": html("Rot", `${dead}<main>${words(50)}</main>`) }, O + "/", { ...OPTIONS, budget: 6 });
    expect(site.requested.filter((p) => p.startsWith("/gone")).length).toBeLessThanOrEqual(12);
    expect(site.pages.map((p) => p.path)).toEqual(["/"]);
  });

  it("stops starting requests once the deadline passes", async () => {
    let clock = 0;
    const routes: Record<string, Route> = { "/": html("Slow", Array.from({ length: 12 }, (_, i) => `<a href="/s${i}x">s</a>`).join("")) };
    for (let i = 0; i < 12; i++) routes[`/s${i}x`] = html(`S${i}`, `<main>${words(100 + i * 250)}</main>`);
    const made = site(O, routes);
    const slow: FetchPage = async (url, o) => {
      clock += 5_000;
      return made.fetchPage(url, o);
    };
    const result = await readSite(O + "/", slow, { ...OPTIONS, deadlineMs: 30_000, now: () => clock });
    if (!result.ok) throw new Error(result.reason);
    expect(result.site.pagesRead).toBeLessThan(13);
    expect(result.site.more).toBe(true);
  });

  it("uses the sitemap for pages nothing links to, after the linked ones", async () => {
    const site = await read({
      "/": html("Acme", `<a href="/pricing">Pricing</a><main>${words(200)}</main>`),
      "/pricing": html("Pricing", `<main><table></table>${words(100)}</main>`),
      "/changelog": html("Changelog", `<main><h1>Changelog</h1><h2>v2</h2>${words(900)}</main>`),
      "/robots.txt": { body: `User-agent: *\nDisallow: /private\nSitemap: ${O}/map.xml\n`, type: "text/plain" },
      "/map.xml": { body: `<urlset><url><loc>${O}/changelog</loc></url><url><loc>${O}/private/notes</loc></url><url><loc>https://elsewhere.example.org/x</loc></url></urlset>`, type: "application/xml" },
      "/private/notes": html("Private", `<main>${words(2000)}</main>`),
    });
    expect(site.pages.map((p) => p.path)).toEqual(["/", "/pricing", "/changelog"]);
    expect(site.requested).not.toContain("/private/notes");
    expect(site.requested.indexOf("/pricing")).toBeLessThan(site.requested.indexOf("/changelog"));
  });

  it("stays out of what robots.txt closes to everyone, or to Commons by name", async () => {
    const site = await read({
      "/": html("Acme", `<a href="/admin/users">Admin</a><a href="/beta/new">Beta</a><a href="/open">Open</a><main>${words(200)}</main>`),
      "/open": html("Open", `<main>${words(700)}</main>`),
      "/admin/users": html("Admin", `<main>${words(900)}</main>`),
      "/beta/new": html("Beta", `<main>${words(1100)}</main>`),
      "/robots.txt": { body: "User-agent: Googlebot\nDisallow: /open\n\nUser-agent: *\nDisallow: /admin\n\nUser-agent: Commons\nDisallow: /beta/\n", type: "text/plain" },
    });
    expect(site.pages.map((p) => p.path)).toEqual(["/", "/open"]);
  });

  it("says when the markup is an empty shell", async () => {
    const shell = `<!doctype html><html><head><title>Acme App</title><script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>`;
    const site = await read({ "/": shell });
    expect(site.clientRendered).toBe(true);
    expect(site.pages).toEqual([{ path: "/", title: "Acme App" }]);
    expect(site.name).toBe("acme.example.com");
  });

  it("reports the header that forbids framing", async () => {
    const site = await read({ "/": { body: html("Acme", `<main>${words(300)}</main>`), headers: { "x-frame-options": "SAMEORIGIN" } } });
    expect(site.refusesFraming).toBe("X-Frame-Options: SAMEORIGIN");
  });

  it("follows the site to its real home and reads it there", async () => {
    const made = site("https://www.acme.example.com", {
      "https://acme.example.com/": { redirect: "https://www.acme.example.com/" },
      "/": html("Acme", `<a href="/about">About</a><main>${words(200)}</main>`),
      "/about": html("About | Acme", `<main><h1>About</h1>${words(600)}</main>`),
    });
    const result = await readSite("https://acme.example.com/", made.fetchPage, OPTIONS);
    if (!result.ok) throw new Error(result.reason);
    expect(result.site.origin).toBe("https://www.acme.example.com");
    expect(result.site.pages.map((p) => p.path)).toEqual(["/", "/about"]);
  });

  it("keeps the front door when the whole app signs in at another company's host", async () => {
    const made = site(O, {
      "/": { redirect: "https://acme.auth-provider.example.net/login" },
      "https://acme.auth-provider.example.net/login": html("Log in", loginForm),
    });
    const result = await readSite(O + "/", made.fetchPage, OPTIONS);
    if (!result.ok) throw new Error(result.reason);
    expect(result.site).toMatchObject({ origin: O, pages: [{ path: "/", title: "Home" }], gatedRoutes: ["/"], name: "acme.example.com" });
  });

  it("explains, in a sentence, why nothing could be read", async () => {
    const refused = async (routes: Record<string, Route>, start = O + "/") => {
      const result = await readSite(start, site(O, routes).fetchPage, OPTIONS);
      if (result.ok) throw new Error("read succeeded");
      return result.reason;
    };
    expect(await refused({}, "https://unreachable.example.org/")).toMatch(/couldn't reach unreachable\.example\.org/);
    expect(await refused({ "/": { status: 503 } })).toBe("acme.example.com answered with a 503 at that address.");
    expect(await refused({ "/": { body: "%PDF-1.7", type: "application/pdf" } })).toMatch(/a file, not a page/);
    for (const reason of [await refused({ "/": { status: 404 } }), await refused({}, "https://unreachable.example.org/")]) {
      expect(reason).toMatch(/^[A-Za-z].*\.$/);
      expect(reason).not.toContain("—");
    }
  });
});

describe("framing", () => {
  const refuses = (headers: Record<string, string>) => framingRefusal(headers, APP);

  it("is refused by X-Frame-Options, and by nothing a browser ignores", () => {
    expect(refuses({ "x-frame-options": "DENY" })).toBe("X-Frame-Options: DENY");
    expect(refuses({ "x-frame-options": "sameorigin" })).toBe("X-Frame-Options: SAMEORIGIN");
    expect(refuses({ "x-frame-options": "ALLOW-FROM https://partner.example.com" })).toBeNull();
    expect(refuses({ "x-frame-options": "garbage" })).toBeNull();
    expect(refuses({})).toBeNull();
  });

  it("reads frame-ancestors the way a browser does", () => {
    const csp = (value: string) => refuses({ "content-security-policy": value });
    expect(csp("default-src 'self'; frame-ancestors 'none'")).toBe("Content-Security-Policy: frame-ancestors 'none'");
    expect(csp("frame-ancestors 'self'")).toBe("Content-Security-Policy: frame-ancestors 'self'");
    expect(csp("frame-ancestors 'self' https://partner.example.com")).toMatch(/frame-ancestors/);
    expect(csp("frame-ancestors *")).toBeNull();
    expect(csp("frame-ancestors https:")).toBeNull();
    expect(csp("frame-ancestors 'self' https://www.trycommons.app")).toBeNull();
    expect(csp("frame-ancestors https://*.trycommons.app")).toBeNull();
    expect(csp("frame-ancestors www.trycommons.app:443")).toBeNull();
    expect(csp("frame-ancestors http://www.trycommons.app")).toMatch(/frame-ancestors/);
    expect(csp("frame-ancestors https://nottrycommons.app")).toMatch(/frame-ancestors/);
    expect(csp("default-src 'self'")).toBeNull();
  });

  it("lets frame-ancestors overrule X-Frame-Options, and any one policy refuse", () => {
    expect(refuses({ "x-frame-options": "DENY", "content-security-policy": "frame-ancestors *" })).toBeNull();
    expect(refuses({ "content-security-policy": "frame-ancestors *, frame-ancestors 'none'" })).toMatch(/'none'/);
  });
});

describe("robots.txt", () => {
  it("collects the rules for everyone and for Commons, and the sitemaps", () => {
    expect(
      parseRobots(
        ["# hello", "User-agent: Googlebot", "Disallow: /g", "", "User-agent: *", "User-agent: Bingbot", "Disallow: /all # trailing", "Allow: /all/ok", "Disallow:", "", "user-agent: commons-reader", "disallow: /c", "Sitemap: https://x.example/s.xml"].join("\n")
      )
    ).toEqual({ disallow: ["/all", "/c"], sitemaps: ["https://x.example/s.xml"] });
    expect(parseRobots("")).toEqual({ disallow: [], sitemaps: [] });
  });
});

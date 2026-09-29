import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { inspectRepo } from "./routeDiscovery";

/**
 * Stack detection and screen discovery against the file layouts of each
 * stack's official starter (create-next-app, create-expo-app, create-vite)
 * plus the repo shapes people actually bring: monorepos, commons.json-only
 * projects, and nothing recognizable at all. These pin the behavior the
 * shared stack table (@commons/shared stacks.ts) has to keep.
 */

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "commons-stack-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const pkg = (deps: Record<string, string>, name = "app") => JSON.stringify({ name, dependencies: deps });
const paths = (routes: { path: string }[]) => routes.map((r) => r.path);

describe("Next.js", () => {
  it("walks the app router: pages, groups as sections, dynamic segments; skips api, private, and slots", async () => {
    const dir = repo({
      "package.json": pkg({ next: "15.1.0", react: "19.0.0" }),
      "app/layout.tsx": "",
      "app/page.tsx": "",
      "app/(marketing)/pricing/page.tsx": "",
      "app/blog/[slug]/page.tsx": "",
      "app/api/hello/route.ts": "",
      "app/_private/page.tsx": "",
      "app/@modal/page.tsx": "",
    });
    const result = await inspectRepo(dir);
    expect(result.framework).toBe("nextjs");
    expect(paths(result.routes)).toEqual(["/", "/blog/[slug]", "/pricing"]);
    expect(result.routes.find((r) => r.path === "/pricing")?.section).toBe("Marketing");
    expect(result.routes.find((r) => r.path === "/blog/[slug]")?.dynamic).toBe(true);
  });

  it("falls back to the pages router", async () => {
    const dir = repo({
      "package.json": pkg({ next: "14.2.0" }),
      "src/pages/_app.tsx": "",
      "src/pages/index.tsx": "",
      "src/pages/about.tsx": "",
      "src/pages/posts/[id].tsx": "",
      "src/pages/api/user.ts": "",
    });
    const result = await inspectRepo(dir);
    expect(paths(result.routes)).toEqual(["/", "/about", "/posts/[id]"]);
  });
});

describe("Expo", () => {
  it("walks expo-router: tabs group as a section, layouts and +files skipped", async () => {
    const dir = repo({
      "package.json": pkg({ expo: "~52.0.0", "expo-router": "~4.0.0", "react-native": "0.76.0", "react-native-web": "~0.19.0" }),
      "app/_layout.tsx": "",
      "app/(tabs)/_layout.tsx": "",
      "app/(tabs)/index.tsx": "",
      "app/(tabs)/explore.tsx": "",
      "app/+not-found.tsx": "",
      "app/modal.tsx": "",
    });
    const result = await inspectRepo(dir);
    expect(result.framework).toBe("expo");
    expect(paths(result.routes)).toEqual(["/", "/explore", "/modal"]);
    expect(result.routes.find((r) => r.path === "/explore")?.section).toBe("Tabs");
  });

  it("reads classic React Navigation screens, addressable through a linking config", async () => {
    const dir = repo({
      "package.json": pkg({ "react-native": "0.76.0", "@react-navigation/native": "^7" }),
      "App.tsx": `
        const linking = { prefixes: ["app://"], config: { screens: { Feed: "feed", Profile: "profile/:id" } } };
        export default () => (
          <NavigationContainer linking={linking}>
            <Stack.Navigator>
              <Stack.Screen name="Feed" component={Feed} />
              <Stack.Screen name="Profile" component={Profile} />
              <Stack.Screen name="Settings" component={Settings} />
            </Stack.Navigator>
          </NavigationContainer>
        );`,
    });
    const result = await inspectRepo(dir);
    expect(result.framework).toBe("expo");
    expect(result.navigatorScreens).toEqual(["Feed", "Profile", "Settings"]);
    expect(paths(result.routes)).toEqual(["/feed", "/profile/:id"]);
    expect(result.routes.find((r) => r.path === "/profile/:id")?.dynamic).toBe(true);
  });

  it("reports navigator screens with no URLs when there is no linking config", async () => {
    const dir = repo({
      "package.json": pkg({ "react-native": "0.76.0" }),
      "App.tsx": `<Tab.Navigator><Tab.Screen name="Home" component={Home} /></Tab.Navigator>`,
    });
    const result = await inspectRepo(dir);
    expect(result.navigatorScreens).toEqual(["Home"]);
    expect(result.routes).toEqual([]);
  });
});

describe("Vite", () => {
  it("starts at the root when nothing declares routes", async () => {
    const dir = repo({
      "package.json": pkg({ vite: "^6.0.0", react: "^19.0.0" }),
      "index.html": "<div id=root></div>",
      "src/main.tsx": "",
    });
    const result = await inspectRepo(dir);
    expect(result.framework).toBe("vite");
    expect(result.routes).toEqual([{ path: "/", file: "commons.json (add more routes here)", dynamic: false }]);
  });
});

describe("commons.json", () => {
  it("declared routes win over discovery", async () => {
    const dir = repo({
      "package.json": pkg({ vite: "^6.0.0" }),
      "commons.json": JSON.stringify({ routes: [{ path: "/pricing", title: "Pricing" }, { path: "/docs/:slug" }] }),
    });
    const result = await inspectRepo(dir);
    expect(paths(result.routes)).toEqual(["/docs/:slug", "/pricing"]);
    expect(result.routes.find((r) => r.path === "/docs/:slug")?.dynamic).toBe(true);
  });

  it("malformed declarations fall back to the stack's own discovery", async () => {
    const dir = repo({
      "package.json": pkg({ next: "15.0.0" }),
      "commons.json": JSON.stringify({ routes: [{ title: "no path" }] }),
      "app/page.tsx": "",
    });
    expect(paths((await inspectRepo(dir)).routes)).toEqual(["/"]);
  });

  it("makes any repo a custom project", async () => {
    const dir = repo({
      "package.json": pkg({ express: "^4" }),
      "commons.json": JSON.stringify({ devCommand: ["node", "server.js", "{port}"], routes: [{ path: "/" }] }),
    });
    const result = await inspectRepo(dir);
    expect(result.framework).toBe("custom");
    expect(paths(result.routes)).toEqual(["/"]);
  });

  it("leaves an unrecognizable repo unknown", async () => {
    const result = await inspectRepo(repo({ "README.md": "hello" }));
    expect(result.framework).toBe("unknown");
    expect(result.routes).toEqual([]);
  });
});

describe("monorepos", () => {
  it("adopts the web app, and reports every app so the picker can offer the others", async () => {
    const dir = repo({
      "package.json": JSON.stringify({ name: "root", private: true }),
      "mobile/package.json": pkg({ expo: "~52", "expo-router": "~4", "react-native-web": "~0.19" }, "mobile"),
      "mobile/app/index.tsx": "",
      "web/package.json": pkg({ next: "15.0.0" }, "web"),
      "web/app/page.tsx": "",
      "api/package.json": pkg({ express: "^4" }, "api"),
    });
    const result = await inspectRepo(dir);
    expect(result.framework).toBe("nextjs");
    expect(result.repoPath).toBe(path.join(dir, "web"));
    expect(result.apps?.map((a) => [a.label, a.framework]).sort()).toEqual([
      ["mobile", "expo"],
      ["web", "nextjs"],
    ]);
  });

  it("does not silently adopt an Expo app that cannot render on the web", async () => {
    const dir = repo({
      "package.json": JSON.stringify({ name: "root" }),
      "mobile/package.json": pkg({ expo: "~52", "expo-router": "~4" }, "mobile"),
    });
    expect((await inspectRepo(dir)).framework).toBe("unknown");
  });
});

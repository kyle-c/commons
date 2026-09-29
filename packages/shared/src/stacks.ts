/**
 * Every stack Commons knows, in one place: how to recognize it, how to run
 * it, where its screens come from, and what shape its frames take. The Mac
 * app reads this for detection and screen discovery (routeDiscovery), the dev
 * server (projectRunner), and frame sizes (frameLayout); the home card and the
 * app picker read its labels. Adding a stack is an entry here, plus a reader
 * in routeDiscovery when it lists screens in a way no stack has before.
 *
 * The static preview build that runs in customers' CI (cloudAgents'
 * RUNNER_SCRIPT) deliberately does not read this table. That script is served
 * byte for byte as written, with nothing spliced in, because it runs with
 * write access to their repos. It barely needs a table anyway: it runs the
 * repo's own build script and finds the output. Its two special cases, Next's
 * static export and Expo's web export, are pinned to this table by a test.
 */

/** Where a stack's screens come from. routeDiscovery implements each one. */
export type ScreenSource =
  /** app/ or src/app: a folder per route, with a page file in it. */
  | "next-app"
  /** pages/ or src/pages: every file is a page. */
  | "next-pages"
  /** app/ or src/app: every file is a screen, _layout and +files aside. */
  | "expo-router"
  /** Screens declared in navigators; addressable only through a linking config. */
  | "react-navigation"
  /** <Route path> elements and route objects in files that use React Router. */
  | "react-router"
  /** No convention to read: start at "/" and let the running-app crawl find the rest. */
  | "root";

export interface StackDef {
  id: string;
  /** How people name it: the home card and the app picker show this. */
  label: string;
  /** Recognized when package.json lists any of these. Table order breaks ties. */
  deps: readonly string[];
  /**
   * In a monorepo, a folder is adopted without asking only when it has all of
   * these: an Expo app has to be able to render on the web first.
   */
  adoptWhen: readonly string[];
  /** Which app a monorepo adopts first when it holds several: web before mobile. */
  adoptRank: number;
  /** The dev server, run through the package manager's exec shim. "{port}" is substituted. */
  dev: readonly string[];
  /** Screen sources, tried in order until one finds screens. */
  screens: readonly ScreenSource[];
  /** Phone stacks get phone-sized frames; the rest, desktop. */
  form: "phone" | "desktop";
}

export const STACKS = [
  {
    id: "nextjs",
    label: "Next.js",
    deps: ["next"],
    adoptWhen: ["next"],
    adoptRank: 0,
    dev: ["next", "dev", "-p", "{port}"],
    screens: ["next-app", "next-pages"],
    form: "desktop",
  },
  {
    id: "expo",
    label: "Expo",
    deps: ["expo-router", "expo", "react-native"],
    adoptWhen: ["expo-router", "react-native-web"],
    adoptRank: 2,
    // Metro serves the web build.
    dev: ["expo", "start", "--web", "--port", "{port}"],
    screens: ["expo-router", "react-navigation"],
    form: "phone",
  },
  {
    id: "vite",
    label: "Vite",
    deps: ["vite"],
    adoptWhen: ["vite"],
    adoptRank: 1,
    // --strictPort: if the port is taken, fail rather than drift to another
    // one the frames don't know about.
    dev: ["vite", "--port", "{port}", "--strictPort"],
    screens: ["root"],
    form: "desktop",
  },
] as const satisfies readonly StackDef[];

export type StackId = (typeof STACKS)[number]["id"];
/** What an inspected app turned out to be: a known stack, a commons.json-only project, or nothing yet. */
export type Framework = StackId | "custom" | "unknown";

/** The stack a package.json describes, or null. One rule, used everywhere. */
export function detectStack(deps: Record<string, unknown>): (typeof STACKS)[number] | null {
  return STACKS.find((stack) => stack.deps.some((dep) => dep in deps)) ?? null;
}

export function stackById(id: string | undefined): (typeof STACKS)[number] | undefined {
  return STACKS.find((stack) => stack.id === id);
}

/** "Next.js", "Expo", "Vite"; anything else is just code. */
export function stackLabel(id: string | undefined): string {
  return stackById(id)?.label ?? "Code";
}

/** The stack's dev command with the port filled in. */
export function devCommandFor(stack: StackDef, port: number): string[] {
  return stack.dev.map((part) => part.replace("{port}", String(port)));
}

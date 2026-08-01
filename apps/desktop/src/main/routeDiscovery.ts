import { promises as fs } from "fs";
import path from "path";
import type { DiscoveredRoute, RepoInspection, AppCandidate } from "@commons/shared";

const PAGE_FILES = ["page.tsx", "page.jsx", "page.ts", "page.js"];
const PAGE_EXTS = [".tsx", ".jsx", ".ts", ".js"];

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** "(tabs)" → "Tabs", "family-member" → "Family Member". */
function humanizeSegment(segment: string): string {
  return segment
    .replace(/^\(|\)$/g, "")
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Walk a Next.js app-router directory collecting routes for every page file. */
async function walkAppDir(
  dir: string,
  urlSegments: string[],
  repoRoot: string,
  out: DiscoveredRoute[],
  section?: string
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && PAGE_FILES.includes(entry.name)) {
      const routePath = "/" + urlSegments.join("/");
      out.push({
        path: routePath === "/" ? "/" : routePath,
        file: path.relative(repoRoot, path.join(dir, entry.name)),
        dynamic: urlSegments.some((s) => s.startsWith("[")),
        section,
      });
    }
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith("_") || name === "node_modules" || name === "api") continue;
    // Parallel routes (@slot) and intercepting routes ((.)x) don't map to URLs.
    if (name.startsWith("@") || name.startsWith("(.")) continue;
    // Route groups contribute no URL segment — but they are the designer's own
    // IA grouping, so keep the name as the section.
    const isGroup = name.startsWith("(") && name.endsWith(")");
    const nextSegments = isGroup ? urlSegments : [...urlSegments, name];
    await walkAppDir(path.join(dir, name), nextSegments, repoRoot, out, isGroup ? humanizeSegment(name) : section);
  }
}

/**
 * Walk an expo-router directory. Conventions mirror Next's app router except
 * every non-special file is a route: `_layout` files aren't routes, `+`-files
 * (`+not-found`, `+html`, `name+api`) are framework/API hooks, `(group)` dirs
 * contribute no URL segment, `index` maps to the parent path.
 */
async function walkExpoDir(
  dir: string,
  urlSegments: string[],
  repoRoot: string,
  out: DiscoveredRoute[],
  section?: string
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (name === "node_modules") continue;
      const isGroup = name.startsWith("(") && name.endsWith(")");
      const nextSegments = isGroup ? urlSegments : [...urlSegments, name];
      await walkExpoDir(path.join(dir, name), nextSegments, repoRoot, out, isGroup ? humanizeSegment(name) : section);
      continue;
    }
    const ext = path.extname(name);
    if (!PAGE_EXTS.includes(ext)) continue;
    const base = name.slice(0, -ext.length);
    if (base.startsWith("_") || base.startsWith("+") || base.includes("+api")) continue;
    const segments = base === "index" ? urlSegments : [...urlSegments, base];
    const routePath = "/" + segments.join("/");
    out.push({
      path: routePath === "/" ? "/" : routePath,
      file: path.relative(repoRoot, path.join(dir, name)),
      dynamic: segments.some((s) => s.startsWith("[")),
      section,
    });
  }
}

/** Walk a pages-router directory. */
async function walkPagesDir(dir: string, urlSegments: string[], repoRoot: string, out: DiscoveredRoute[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (name === "api" || name === "node_modules") continue;
      await walkPagesDir(path.join(dir, name), [...urlSegments, name], repoRoot, out);
      continue;
    }
    const ext = path.extname(name);
    if (!PAGE_EXTS.includes(ext)) continue;
    const base = name.slice(0, -ext.length);
    if (base.startsWith("_")) continue;
    const segments = base === "index" ? urlSegments : [...urlSegments, base];
    const routePath = "/" + segments.join("/");
    out.push({
      path: routePath === "/" ? "/" : routePath,
      file: path.relative(repoRoot, path.join(dir, name)),
      dynamic: segments.some((s) => s.startsWith("[")),
    });
  }
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const STYLE_FILE = /(\.(css|scss)|^tailwind\.config\.(js|ts|cjs|mjs)|^theme\.(ts|js|json))$/;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".expo"]);

async function collectStyleFiles(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > 4 || out.length >= 15) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= 15) return;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        await collectStyleFiles(path.join(dir, entry.name), depth + 1, out);
      }
    } else if (STYLE_FILE.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
}

/**
 * The repo's two most prominent brand colors: hex values mined from
 * stylesheets/theme files, greys and near-black/white filtered out, ranked by
 * frequency, second pick forced to a distinct hue.
 */
async function detectBrandColors(repoPath: string): Promise<string[] | undefined> {
  const files: string[] = [];
  await collectStyleFiles(repoPath, 0, files);
  const counts = new Map<string, number>();
  for (const file of files) {
    let text: string;
    try {
      text = (await fs.readFile(file, "utf8")).slice(0, 100_000);
    } catch {
      continue;
    }
    for (const match of text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      let hex = match[1].toLowerCase();
      if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  const vivid = [...counts.entries()]
    .map(([hex, count]) => ({ hex, count, ...hexToHsl(hex) }))
    .filter((c) => c.s >= 0.2 && c.l >= 0.18 && c.l <= 0.88)
    .sort((a, b) => b.count - a.count);
  if (vivid.length === 0) return undefined;
  const first = vivid[0];
  const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const second = vivid.find((c) => c !== first && hueDist(c.h, first.h) >= 35) ?? vivid[1];
  return second ? [`#${first.hex}`, `#${second.hex}`] : [`#${first.hex}`];
}

/**
 * Does this repo deploy on Vercel, and what is the project called?
 *
 * Deliberately does not return a branch-preview pattern. The URL is
 * `<project>-git-<branch>-<scope>.vercel.app`, and the scope is the team slug,
 * which appears in neither vercel.json nor .vercel/project.json (that file has
 * projectId and orgId — opaque ids — and only sometimes projectName). Guessing
 * the scope would produce a URL that 404s, which is worse than an empty field.
 * So this feeds a placeholder, and the GitHub App learns the real pattern from
 * observed deploys.
 */
async function detectVercel(repoPath: string): Promise<{ projectName?: string } | undefined> {
  let found = false;
  let projectName: string | undefined;
  try {
    await fs.access(path.join(repoPath, "vercel.json"));
    found = true;
  } catch {
    /* not there; .vercel may still be */
  }
  try {
    const raw = await fs.readFile(path.join(repoPath, ".vercel", "project.json"), "utf8");
    found = true;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.projectName === "string") projectName = parsed.projectName;
  } catch {
    /* absent or unparseable — the vercel.json signal may still stand */
  }
  return found ? { projectName } : undefined;
}

/** origin URL from .git/config — no git binary needed. */
async function detectGitRemote(repoPath: string): Promise<string | undefined> {
  try {
    const config = await fs.readFile(path.join(repoPath, ".git", "config"), "utf8");
    let inOrigin = false;
    for (const line of config.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[")) inOrigin = trimmed === '[remote "origin"]';
      else if (inOrigin) {
        const match = trimmed.match(/^url\s*=\s*(.+)$/);
        if (match) return match[1].trim();
      }
    }
  } catch {
    // Not a git repo (or a worktree) — fine, identity stays unset.
  }
  return undefined;
}

async function detectPackageManager(repoPath: string): Promise<RepoInspection["packageManager"]> {
  if (await exists(path.join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(repoPath, "yarn.lock"))) return "yarn";
  if (await exists(path.join(repoPath, "bun.lock")) || (await exists(path.join(repoPath, "bun.lockb")))) return "bun";
  return "npm";
}

/**
 * commons.json — the escape hatch that makes any framework a Commons project
 * (Vite + React Router, CRA, plain static, anything that serves HTTP):
 *   { "devCommand": ["npx", "vite", "--port", "{port}"],   // optional; {port} substituted
 *     "port": 5173,                                        // optional fixed port
 *     "routes": [{ "path": "/", "title": "Home", "section": "Main" }, …],
 *     "device": { "width": 390, "height": 844 } }          // optional frame size
 * Declared routes always win over discovery.
 */
interface CommonsConfig {
  devCommand?: string[];
  port?: number;
  routes?: { path: string; title?: string; section?: string }[];
  device?: { width: number; height: number };
}

export async function readCommonsConfig(repoPath: string): Promise<CommonsConfig | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(repoPath, "commons.json"), "utf8"));
    return raw && typeof raw === "object" ? (raw as CommonsConfig) : null;
  } catch {
    return null;
  }
}

/** The git root at or above dir, so app discovery works from any subfolder. */
async function gitRootOf(dir: string): Promise<string> {
  let current = dir;
  for (let i = 0; i < 8; i += 1) {
    try {
      await fs.stat(path.join(current, ".git"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return dir;
}

/**
 * Every runnable app in a repo, newest question first: which one are you
 * looking at? A monorepo with a web app and a mobile app has two right
 * answers, and Commons must not pick one on the user's behalf without saying.
 *
 * Works from any path inside the repo (including an already-adopted
 * subfolder), so the picker can still offer the siblings after a choice.
 */
export async function listRepoApps(fromPath: string): Promise<AppCandidate[]> {
  const root = await gitRootOf(fromPath);
  const found: AppCandidate[] = [];
  const classify = (deps: Record<string, string>): RepoInspection["framework"] | null =>
    deps.next ? "nextjs" : deps.vite ? "vite" : deps.expo || deps["react-native"] ? "expo" : null;

  const read = async (dir: string): Promise<{ framework: RepoInspection["framework"]; name?: string } | null> => {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
      const framework = classify({ ...pkg.dependencies, ...pkg.devDependencies });
      return framework ? { framework, name: pkg.name } : null;
    } catch {
      return null;
    }
  };

  const atRoot = await read(root);
  if (atRoot) found.push({ path: root, label: path.basename(root), ...atRoot });
  try {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = await read(path.join(root, entry.name));
      if (child) found.push({ path: path.join(root, entry.name), label: entry.name, ...child });
    }
  } catch {
    // Unreadable repo — whatever we already found stands.
  }
  return found;
}


/**
 * Screens of a classic React Navigation app (no expo-router).
 *
 * expo-router puts routes on disk, so they enumerate by walking folders. A
 * classic navigator registers screens in JSX — `<Stack.Screen name="Feed" …>`
 * — which is still static and still readable, so the screen list is genuinely
 * recoverable. What is NOT recoverable is a URL per screen: React Navigation
 * only maps screens to paths when the app supplies a `linking` config. Without
 * one, every screen lives at the same address on web and Commons would have to
 * invent paths to draw them apart — which it will not do.
 *
 * So this reports both halves honestly: the screens it found, and whether they
 * are addressable. The UI turns "found 10, none addressable" into the exact
 * one-time fix rather than an empty canvas.
 */
export async function discoverNavigatorScreens(
  appDir: string
): Promise<{ screens: string[]; linkingPaths: Record<string, string> | null }> {
  const files: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (/\.(tsx|jsx|ts|js)$/.test(entry.name)) files.push(full);
    }
  };
  await walk(appDir, 0);

  const screens: string[] = [];
  let linkingPaths: Record<string, string> | null = null;
  // <Stack.Screen name="Feed" …> / <Tab.Screen …> / <Drawer.Screen …>
  const screenTag = /<\s*[A-Za-z_$][\w$]*\.Screen\b[^>]*?\bname\s*=\s*["']([^"']+)["']/g;

  for (const file of files) {
    let source: string;
    try {
      source = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(screenTag)) {
      if (!screens.includes(match[1])) screens.push(match[1]);
    }
    // A linking config makes screens addressable: linking={{ prefixes, config:
    // { screens: { Feed: "feed" } }}. Read the leaf mapping when it's there.
    if (linkingPaths === null && /\bprefixes\s*:/.test(source)) {
      const screensBlock = source.match(/screens\s*:\s*\{([\s\S]*?)\}/);
      if (screensBlock) {
        const pairs: Record<string, string> = {};
        for (const pair of screensBlock[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*["']([^"']+)["']/g)) {
          pairs[pair[1]] = pair[2];
        }
        if (Object.keys(pairs).length > 0) linkingPaths = pairs;
      }
    }
  }
  return { screens, linkingPaths };
}

export async function inspectRepo(repoPath: string): Promise<RepoInspection> {
  let framework: RepoInspection["framework"] = "unknown";
  let name = path.basename(repoPath);
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8"));
    if (pkg.name) name = pkg.name;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) framework = "nextjs";
    else if (deps["expo-router"] || deps.expo || deps["react-native"]) framework = "expo";
    else if (deps.vite) framework = "vite";
  } catch {
    // No package.json — leave as unknown; caller surfaces the error state.
  }

  const config = await readCommonsConfig(repoPath);
  if (config && framework === "unknown") framework = "custom";

  // Monorepo descent: a picked root with no app of its own (vibebnb-style
  // frontend/ + backend/ + mobile/ layouts) inspects one level down and
  // adopts the best child app as the project path. Web apps win over
  // mobile; the repo root still owns git via the subfolder.
  if (framework === "unknown" && !config) {
    const candidates: { path: string; framework: RepoInspection["framework"] }[] = [];
    try {
      for (const entry of await fs.readdir(repoPath, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
        try {
          const childPkg = JSON.parse(
            await fs.readFile(path.join(repoPath, entry.name, "package.json"), "utf8")
          );
          const childDeps = { ...childPkg.dependencies, ...childPkg.devDependencies };
          if (childDeps.next) candidates.push({ path: entry.name, framework: "nextjs" });
          else if (childDeps.vite) candidates.push({ path: entry.name, framework: "vite" });
          else if (childDeps["expo-router"] && childDeps["react-native-web"])
            candidates.push({ path: entry.name, framework: "expo" });
        } catch {
          // Not an app folder — skip.
        }
      }
    } catch {
      // Unreadable dir — fall through to the unknown result.
    }
    const rank = { nextjs: 0, vite: 1, expo: 2 } as Record<string, number>;
    candidates.sort((a, b) => rank[a.framework] - rank[b.framework] || a.path.localeCompare(b.path));
    if (candidates.length > 0) {
      // Still adopt the top-ranked app so nothing regresses — but report the
      // others. Silently choosing between a repo's web and mobile apps and
      // never saying so is how you end up looking at six web pages when you
      // expected a phone.
      const adopted = await inspectRepo(path.join(repoPath, candidates[0].path));
      return { ...adopted, apps: await listRepoApps(repoPath) };
    }
  }

  const routes: DiscoveredRoute[] = [];
  // Declared routes beat discovery — deterministic across every framework.
  if (config?.routes?.length) {
    for (const r of config.routes) {
      if (typeof r?.path !== "string") continue;
      routes.push({
        path: r.path,
        file: "commons.json",
        dynamic: /[[\]:]/.test(r.path),
        section: r.section,
        title: r.title,
      });
    }
  } else if (framework === "vite") {
    // No filesystem routing convention to walk — start with the root and
    // point people at commons.json for the rest.
    routes.push({ path: "/", file: "commons.json (add more routes here)", dynamic: false });
  }
  if (routes.length === 0 && framework === "expo") {
    for (const appDir of ["app", "src/app"]) {
      const abs = path.join(repoPath, appDir);
      if (await exists(abs)) {
        await walkExpoDir(abs, [], repoPath, routes);
        break;
      }
    }
  }

  // Still nothing: a classic React Navigation app. Its screens are declared in
  // JSX rather than on disk, so read them from the navigators. They become
  // real routes only when the app has a linking config to give them URLs.
  let navigatorScreens: string[] | undefined;
  if (routes.length === 0 && framework === "expo") {
    const found = await discoverNavigatorScreens(repoPath);
    if (found.screens.length > 0) {
      navigatorScreens = found.screens;
      if (found.linkingPaths) {
        for (const name of found.screens) {
          const mapped = found.linkingPaths[name];
          if (!mapped) continue;
          routes.push({
            path: mapped.startsWith("/") ? mapped : `/${mapped}`,
            file: "react-navigation",
            title: name,
            dynamic: /:|\[/.test(mapped),
          });
        }
      }
    }
  }
  if (routes.length === 0 && framework === "nextjs") {
    for (const appDir of ["app", "src/app"]) {
      const abs = path.join(repoPath, appDir);
      if (await exists(abs)) {
        await walkAppDir(abs, [], repoPath, routes);
        break;
      }
    }
    if (routes.length === 0) {
      for (const pagesDir of ["pages", "src/pages"]) {
        const abs = path.join(repoPath, pagesDir);
        if (await exists(abs)) {
          await walkPagesDir(abs, [], repoPath, routes);
          break;
        }
      }
    }
  }

  // Sections not set by an explicit router group fall back to the first URL
  // segment — but only when at least two routes share it (singletons stay
  // ungrouped rather than becoming one-frame sections).
  const segmentCounts = new Map<string, number>();
  for (const route of routes) {
    if (route.section) continue;
    const first = route.path.split("/")[1];
    if (first) segmentCounts.set(first, (segmentCounts.get(first) ?? 0) + 1);
  }
  for (const route of routes) {
    if (route.section) continue;
    const first = route.path.split("/")[1];
    if (first && (segmentCounts.get(first) ?? 0) >= 2) route.section = humanizeSegment(first);
  }

  routes.sort((a, b) => a.path.localeCompare(b.path));
  return {
    navigatorScreens,
    repoPath,
    name,
    framework,
    device:
      config?.device && typeof config.device.width === "number" && typeof config.device.height === "number"
        ? config.device
        : undefined,
    packageManager: await detectPackageManager(repoPath),
    routes,
    gitRemote: await detectGitRemote(repoPath),
    brandColors: await detectBrandColors(repoPath),
    vercel: await detectVercel(repoPath),
  };
}

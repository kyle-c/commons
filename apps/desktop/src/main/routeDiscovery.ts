import { promises as fs } from "fs";
import path from "path";
import type { DiscoveredRoute, RepoInspection } from "@commons/shared";

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

export async function inspectRepo(repoPath: string): Promise<RepoInspection> {
  let framework: RepoInspection["framework"] = "unknown";
  let name = path.basename(repoPath);
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8"));
    if (pkg.name) name = pkg.name;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) framework = "nextjs";
    else if (deps["expo-router"] && deps["react-native-web"]) framework = "expo";
    else if (deps.vite) framework = "vite";
  } catch {
    // No package.json — leave as unknown; caller surfaces the error state.
  }

  const config = await readCommonsConfig(repoPath);
  if (config && framework === "unknown") framework = "custom";

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
  };
}

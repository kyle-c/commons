#!/usr/bin/env node
/**
 * Publish the renderer as the browser web app, served by the deployment at
 * /app (Convex storage-backed, zero extra hosting — same pattern as the
 * update feed).
 *
 *   node scripts/publish-webapp.mjs          # dev deployment
 *   node scripts/publish-webapp.mjs --prod   # prod (what clients hit)
 *
 * Builds the renderer with the target deployment's URL baked in, uploads
 * assets to storage, rewrites index.html to reference /app/assets/*.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(root, "packages/backend");
const rendererDir = path.join(root, "apps/desktop/out/renderer");
const prod = process.argv.includes("--prod");
const convexUrl = prod ? "https://rapid-anteater-106.convex.cloud" : "https://basic-raven-343.convex.cloud";
const convexFlags = prod ? ["--prod"] : [];

console.log(`Building renderer for ${prod ? "PROD" : "dev"}…`);
execFileSync("npx", ["electron-vite", "build"], {
  cwd: path.join(root, "apps/desktop"),
  env: { ...process.env, VITE_CONVEX_URL: convexUrl },
  stdio: "inherit",
});

function convexRun(fn, args) {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args ?? {}), ...convexFlags], {
    cwd: backendDir,
    encoding: "utf8",
  }).trim();
  return out === "" ? null : JSON.parse(out);
}

// Upload every asset; index.html is stored inline (rewritten to /app/ paths).
const files = [];
function walk(dir, prefix) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) walk(full, rel);
    else if (rel !== "index.html") files.push(rel);
  }
}
walk(rendererDir, "");

const uploaded = [];
for (const name of files) {
  const uploadUrl = convexRun("updates:createUploadUrl");
  const type = name.endsWith(".js")
    ? "text/javascript"
    : name.endsWith(".css")
      ? "text/css"
      : name.endsWith(".svg")
        ? "image/svg+xml"
        : "application/octet-stream";
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": type },
    body: readFileSync(path.join(rendererDir, name)),
  });
  if (!res.ok) throw new Error(`upload of ${name} failed: ${res.status}`);
  const { storageId } = await res.json();
  uploaded.push({ name, storageId });
  console.log(`  uploaded ${name}`);
}

let indexHtml = readFileSync(path.join(rendererDir, "index.html"), "utf8");
// electron-vite emits relative ("./assets/…") refs for file:// loading —
// rebase them onto the /app/ mount.
indexHtml = indexHtml.replaceAll('"./', '"/app/').replaceAll("'./", "'/app/");
// Cache-bust every asset reference per publish: browsers cache the 302
// redirects, and republishing deletes the old storage targets.
const v = Date.now();
indexHtml = indexHtml.replaceAll(/(\/app\/assets\/[^"']+)/g, `$1?v=${v}`);
// The desktop CSP pins script-src to 'self', but /app assets 302 to the
// deployment's storage origin — swap in a web-appropriate policy.
indexHtml = indexHtml.replace(
  /content="default-src[^"]*"/,
  `content="default-src 'self'; script-src 'self' https://*.convex.cloud; style-src 'self' 'unsafe-inline' https://*.convex.cloud; connect-src 'self' https://*.convex.cloud wss://*.convex.cloud; frame-src https:; img-src 'self' data: https:;"`
);

convexRun("updates:publishWebApp", { indexHtml, files: uploaded });
console.log(`Done — ${prod ? "https://rapid-anteater-106" : "https://basic-raven-343"}.convex.site/app serves the web app.`);

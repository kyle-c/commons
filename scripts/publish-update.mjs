#!/usr/bin/env node
/**
 * Publish a built desktop release to the Convex auto-update feed.
 *
 * Usage (after `pnpm -C apps/desktop dist`):
 *   node scripts/publish-update.mjs         # publish to the dev deployment
 *   node scripts/publish-update.mjs --prod  # publish to prod (what installed apps poll)
 *
 * Reads apps/desktop/release/latest-mac.yml, uploads every file it references
 * (the zips electron-updater installs from) to Convex storage, then records
 * the release. The /update/* HTTP routes serve whatever was published last.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "apps/desktop/release");
const backendDir = path.join(root, "packages/backend");
const prod = process.argv.includes("--prod");
const convexFlags = prod ? ["--prod"] : [];

function convexRun(fn, args) {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args ?? {}), ...convexFlags], {
    cwd: backendDir,
    encoding: "utf8",
  });
  const trimmed = out.trim();
  return trimmed === "" ? null : JSON.parse(trimmed);
}

const channelYml = readFileSync(path.join(releaseDir, "latest-mac.yml"), "utf8");
const version = channelYml.match(/^version:\s*(.+)$/m)?.[1]?.trim();
if (!version) throw new Error("latest-mac.yml has no version field");

// Every artifact the yml references (mac updates ship as zips).
const names = [...new Set([...channelYml.matchAll(/^\s+- url:\s*(.+)$|^path:\s*(.+)$/gm)].map((m) => (m[1] ?? m[2]).trim()))];
console.log(`Publishing ${version} to ${prod ? "PROD" : "dev"} — files: ${names.join(", ")}`);

const files = [];
for (const name of names) {
  const filePath = path.join(releaseDir, name);
  const size = statSync(filePath).size;
  const uploadUrl = convexRun("updates:createUploadUrl");
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: readFileSync(filePath),
  });
  if (!res.ok) throw new Error(`upload of ${name} failed: ${res.status} ${await res.text()}`);
  const { storageId } = await res.json();
  files.push({ name, storageId, size });
  console.log(`  uploaded ${name} (${(size / 1e6).toFixed(1)} MB)`);
}

convexRun("updates:publish", { version, channelYml, files });
console.log(`Done — feed now serves ${version}.`);

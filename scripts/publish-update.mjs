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

// These ~200MB uploads flake (node fetch EPIPEs, curl hits send errors on a
// bad network moment). Retry with backoff, minting a fresh upload URL each
// attempt — a partially consumed URL can't be trusted twice.
async function upload(filePath) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const uploadUrl = convexRun("updates:createUploadUrl");
    try {
      const out = execFileSync(
        "curl",
        // Full-speed uploads hit SSL "bad record mac" on flaky moments; a
        // capped rate has been reliable and only adds ~30s per file.
        ["-sS", "--fail", "--limit-rate", "8M", "-X", "POST", "-H", "Content-Type: application/octet-stream", "--data-binary", `@${filePath}`, uploadUrl],
        { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
      );
      return JSON.parse(out).storageId;
    } catch (error) {
      lastError = error;
      console.log(`  upload attempt ${attempt} failed (${error.status ?? error.message}) — retrying in ${attempt * 3}s`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  throw lastError;
}

/**
 * Last resort when this machine's uplink corrupts sustained uploads: the
 * GitHub release (uploaded earlier in the pipeline, by gh's own transport)
 * already holds the bytes, so the deployment pulls them itself via
 * updateIngest:fromUrl. Assumes the release step ran and tag v<version>
 * carries the artifact.
 */
function ingestViaGitHub(name) {
  const repo = "kyle-c/commons";
  const tag = `v${version}`;
  console.log(`  falling back: prod ingests ${name} from the ${tag} GitHub release`);
  const assets = JSON.parse(
    execFileSync("gh", ["api", `repos/${repo}/releases/tags/${tag}`, "--jq", "[.assets[] | {id, name}]"], {
      encoding: "utf8",
    })
  );
  const asset = assets.find((a) => a.name === name);
  if (!asset) throw new Error(`no asset ${name} on GitHub release ${tag} — run gh release create first`);
  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const headers = execFileSync(
    "curl",
    ["-sI", "-H", `Authorization: token ${token}`, "-H", "Accept: application/octet-stream", `https://api.github.com/repos/${repo}/releases/assets/${asset.id}`],
    { encoding: "utf8" }
  );
  const signedUrl = headers
    .split(/\r?\n/)
    .find((l) => /^location:/i.test(l))
    ?.replace(/^location:\s*/i, "")
    .trim();
  if (!signedUrl) throw new Error(`no signed URL for asset ${name}`);
  return convexRun("updateIngest:fromUrl", { url: signedUrl }).storageId;
}

const files = [];
for (const name of names) {
  const filePath = path.join(releaseDir, name);
  const size = statSync(filePath).size;
  let storageId;
  try {
    storageId = await upload(filePath);
  } catch {
    storageId = ingestViaGitHub(name);
  }
  files.push({ name, storageId, size });
  console.log(`  uploaded ${name} (${(size / 1e6).toFixed(1)} MB)`);
}

convexRun("updates:publish", { version, channelYml, files });
console.log(`Done — feed now serves ${version}.`);

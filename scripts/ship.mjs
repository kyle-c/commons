#!/usr/bin/env node
/**
 * Ship a release, end to end, with the checks that actually catch things.
 *
 *   pnpm ship --notes "What changed, in user language."
 *   pnpm ship --notes-file NOTES.md      # same, from a file
 *   pnpm ship --version 0.3.0            # explicit version (default: patch bump)
 *   pnpm ship --dry-run                  # preflight + plan only, changes nothing
 *
 * This replaces a nine-step manual sequence. Doing it by hand is not merely
 * tedious — it is where the real mistakes live:
 *
 *   - Building before the version bump, so the artifact disagrees with the tag.
 *   - Releasing a build that predates a commit made while it was building.
 *   - Trusting "Done" from the feed upload when it silently fell back.
 *   - Forgetting the backend when the release needs one, or deploying one it
 *     doesn't (which is how a breaking change reaches clients unannounced).
 *
 * So the ordering here is deliberate: bump first, build from a clean tree,
 * verify the built bundle carries the intended version, and verify the feed
 * serves the exact bytes that were notarized. Every step aborts on failure.
 *
 * Apple credentials come from the environment and are never stored here:
 *   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 */
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = path.join(root, "apps/desktop");
const backendDir = path.join(root, "packages/backend");
const pkgPath = path.join(desktopDir, "package.json");

const PROD_CONVEX_URL = "https://rapid-anteater-106.convex.cloud";
const PROD_SITE = "https://rapid-anteater-106.convex.site";
const REPO_RELEASES = "https://github.com/kyle-c/commons/releases";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

let step = 0;
const say = (msg) => console.log(`\n[${++step}] ${msg}`);
const detail = (msg) => console.log(`    ${msg}`);
const die = (msg) => {
  console.error(`\n✘ ${msg}\n`);
  process.exit(1);
};

function run(bin, argv, opts = {}) {
  return execFileSync(bin, argv, { encoding: "utf8", stdio: "pipe", ...opts });
}
function runLoud(bin, argv, opts = {}) {
  return execFileSync(bin, argv, { stdio: "inherit", ...opts });
}
function git(...argv) {
  return run("git", argv, { cwd: root }).trim();
}

// ── 1. Preflight ────────────────────────────────────────────────────────────
// Everything that can be known before we change anything, checked up front, so
// a failure costs seconds instead of a notarization round-trip.

say("Preflight");

const notes = flag("--notes") ?? (flag("--notes-file") ? readFileSync(flag("--notes-file"), "utf8") : null);
if (!notes && !dryRun) {
  die(
    "Release notes are required: --notes \"...\" or --notes-file PATH.\n" +
      "  They're what people read in the update prompt — worth writing by hand."
  );
}

if (git("status", "--porcelain")) {
  die("Working tree is dirty. Commit or stash first — the artifact must match a commit.");
}
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") die(`On branch "${branch}". Releases ship from main.`);

// Tags too, not just main: `gh release create` makes the tag server-side, so
// a machine that has shipped from elsewhere is missing recent ones entirely.
git("fetch", "--quiet", "--tags", "origin", "main");
if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) {
  die("Local main and origin/main disagree. Pull or push first.");
}
detail(`clean tree on main @ ${git("rev-parse", "--short", "HEAD")}`);

for (const key of ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
  if (!process.env[key]) die(`${key} is not set. Notarization needs all three Apple env vars.`);
}
detail(`apple credentials present (${process.env.APPLE_ID})`);

try {
  run("gh", ["auth", "status"]);
} catch {
  die("gh is not authenticated. Run: gh auth login");
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const version =
  flag("--version") ??
  (() => {
    const [maj, min, patch] = current.split(".").map(Number);
    return `${maj}.${min}.${patch + 1}`;
  })();
if (version === current) die(`Version ${version} is already the current version.`);

const tags = git("tag", "--list").split("\n").filter(Boolean);
if (tags.includes(`v${version}`)) die(`Tag v${version} already exists.`);
detail(`version ${current} → ${version}`);

/** Semver order, not string order — "v0.2.9" sorts above "v0.2.71" lexically. */
function latestTag(all) {
  const parsed = all
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .map((t) => ({ tag: t, parts: t.slice(1).split(".").map(Number) }));
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => a.parts[0] - b.parts[0] || a.parts[1] - b.parts[1] || a.parts[2] - b.parts[2]);
  return parsed[parsed.length - 1].tag;
}

// Does the backend need deploying? Compare convex/ against the last shipped
// tag: shipping a client that needs a function the deployment lacks is the
// failure mode, and so is deploying a backend nobody asked for.
const lastTag = latestTag(tags);
const convexChanged = lastTag
  ? git("diff", "--name-only", `${lastTag}..HEAD`, "--", "packages/backend/convex").length > 0
  : true;
detail(
  `baseline ${lastTag ?? "(no tags)"} — ` +
    (convexChanged ? "backend changed → will deploy" : "no backend changes → client-only ship")
);

say("Typecheck and authorization check");
if (dryRun) {
  detail("(skipped in dry run)");
} else {
  runLoud("pnpm", ["typecheck"], { cwd: root });
}

if (dryRun) {
  console.log(`\n✓ Dry run complete. Would ship v${version}${convexChanged ? " with a backend deploy" : ""}.\n`);
  process.exit(0);
}

// ── 2. Backend first ────────────────────────────────────────────────────────
// Before the client, always: Convex rejects arguments a function doesn't
// declare, so a new client cannot talk to an old deployment.

if (convexChanged) {
  say("Deploy backend to prod");
  runLoud("npx", ["convex", "deploy", "-y"], { cwd: backendDir });
}

// ── 3. Version, commit, build ───────────────────────────────────────────────

say(`Bump to ${version} and push`);
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
git("add", "-A");
git("commit", "-m", `v${version}`);
git("push");
detail(`committed and pushed v${version}`);

say("Build, sign, notarize (several minutes)");
runLoud("pnpm", ["dist"], {
  cwd: desktopDir,
  env: { ...process.env, VITE_CONVEX_URL: PROD_CONVEX_URL },
});

// ── 4. Validate the artifact ────────────────────────────────────────────────
// Never publish something unexamined. The version check here is what catches
// a build that started before the bump.

say("Validate the notarized artifact");
const dmg = path.join(desktopDir, "release", `Commons-${version}-arm64.dmg`);
const zip = path.join(desktopDir, "release", `Commons-${version}-arm64-mac.zip`);
for (const f of [dmg, zip]) if (!existsSync(f)) die(`Expected artifact missing: ${f}`);

const mount = "/tmp/commons-ship-dmg";
run("rm", ["-rf", mount]);
run("mkdir", ["-p", mount]);
run("hdiutil", ["attach", dmg, "-mountpoint", mount, "-nobrowse", "-quiet"]);
try {
  run("xcrun", ["stapler", "validate", `${mount}/Commons.app`]);
  detail("stapled");
  const spctl = execSync(`spctl -a -vvv -t exec ${mount}/Commons.app 2>&1`, { encoding: "utf8" });
  if (!spctl.includes("accepted")) die(`Gatekeeper rejected the build:\n${spctl}`);
  detail("gatekeeper: accepted");
  const built = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print CFBundleShortVersionString",
    `${mount}/Commons.app/Contents/Info.plist`,
  ]).trim();
  if (built !== version) {
    die(`Built bundle says ${built} but we're shipping ${version} — the build predates the bump.`);
  }
  detail(`bundle version ${built}`);
} finally {
  run("hdiutil", ["detach", mount, "-quiet"]);
}

// ── 5. Publish ──────────────────────────────────────────────────────────────

say("Publish the web app to prod");
runLoud("node", [path.join(root, "scripts/publish-webapp.mjs"), "--prod"], { cwd: root });

say(`Create GitHub release v${version}`);
runLoud("gh", ["release", "create", `v${version}`, dmg, zip, "--title", `v${version}`, "--notes", notes], {
  cwd: root,
});

say("Publish the auto-update feed");
runLoud("node", [path.join(root, "scripts/publish-update.mjs"), "--prod"], { cwd: root });

// ── 6. Verify what users will actually receive ──────────────────────────────
// The feed upload has a fallback path that can succeed quietly after the
// direct upload fails, so "Done" is not evidence. Hashes are.

say("Verify the published release");

const feed = run("curl", ["-s", `${PROD_SITE}/update/latest-mac.yml`]);
const feedVersion = /version:\s*(\S+)/.exec(feed)?.[1];
if (feedVersion !== version) die(`Feed serves ${feedVersion}, expected ${version}.`);
detail(`feed serves ${feedVersion}`);

const localHash = createHash("sha512").update(readFileSync(zip)).digest("base64");
const feedHash = /sha512:\s*(\S+)/.exec(feed)?.[1];
if (feedHash !== localHash) {
  die(
    "Feed hash does not match the zip that was notarized.\n" +
      "  The upload may have fallen back or truncated — do not leave this release published."
  );
}
detail("feed sha512 matches the notarized zip");

const status = run("curl", [
  "-sL",
  "-o",
  "/dev/null",
  "-w",
  "%{http_code}",
  "-r",
  "0-1048576",
  `${PROD_SITE}/update/Commons-${version}-arm64-mac.zip`,
]).trim();
if (!["200", "206"].includes(status)) die(`Artifact not downloadable from the feed (HTTP ${status}).`);
detail(`artifact downloadable (HTTP ${status})`);

const download = run("curl", ["-sL", "-o", "/dev/null", "-w", "%{http_code}", `${PROD_SITE}/download`]).trim();
if (!["200", "206"].includes(download)) die(`trycommons.app/download is broken (HTTP ${download}).`);
detail(`/download resolves (HTTP ${download})`);

const sizeMb = (statSync(dmg).size / 1e6).toFixed(1);
console.log(`\n✓ v${version} shipped — ${sizeMb} MB, notarized, feed verified.`);
console.log(`  ${REPO_RELEASES}/tag/v${version}\n`);

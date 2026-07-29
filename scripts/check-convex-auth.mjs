#!/usr/bin/env node
/**
 * Fail if a public Convex function can be called without proving who you are.
 *
 *   node scripts/check-convex-auth.mjs
 *
 * Convex publishes every non-internal query/mutation/action to the open
 * internet at the deployment URL, and that URL ships inside the web app and
 * every DMG. So a public function without a viewer check is reachable by
 * anyone who knows a document id — and ids are not secret, they travel in
 * deep links, thread links, and Slack posts.
 *
 * This once found 30 such functions (see SECURITY-REVIEW.md). The point of
 * this check is that it cannot happen again quietly: adding an open function
 * now requires adding it to OPEN_BY_DESIGN below, with a reason, in the diff.
 *
 * It is deliberately a text scan rather than a type-aware analysis. That makes
 * it dumb but unbypassable-by-accident: the failure mode is a false positive
 * you resolve by naming the function, never a false negative that ships.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const convexDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../packages/backend/convex"
);

/**
 * Anything that establishes identity from the session, or checks access using
 * an already-resolved identity. A body mentioning none of these is ungated.
 */
const GATES = [
  "requireViewer",
  "requireProjectAccess",
  "requireProject", // annotations.ts keeps a local helper of this name
  "resolveViewer",
  "accessibleProject",
  "canAccessProject",
  "isWorkspaceMember",
  "isMember",
];

/**
 * Functions that must stay callable by someone with no session, with the
 * reason. Everything here is part of establishing a session in the first
 * place — requiring one would be circular.
 */
const OPEN_BY_DESIGN = {
  "auth.ts:start": "begins Google sign-in; no session exists yet",
  "auth.ts:startEmailSignIn": "begins email-link sign-in; no session exists yet",
  "auth.ts:status": "polls a pending sign-in, keyed on the flow's own state secret",
  "auth.ts:claim": "redeems a single-use, expiring state secret for a token",
  "auth.ts:validate": "checks a token's validity — holding the token is the proof",
  "auth.ts:touch": "refreshes a token — holding the token is the proof",
  "auth.ts:signOut": "revokes the token supplied — you can only revoke one you hold",
  "projects.ts:sharePage":
    "guest mode (/g/<token>): the share token is the credential, exactly as for the /p/ page it replaces. " +
    "Revoking it in Sharing cuts access instantly, and only approved annotations are returned",
};

// Files with no public API surface worth scanning.
const SKIP_FILES = new Set(["schema.ts", "http.ts", "crons.ts", "auth.config.ts"]);

/** Body of the object literal passed to query/mutation/action, by brace matching. */
function bodyAfter(source, openBraceIndex) {
  let depth = 1;
  let i = openBraceIndex;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  return source.slice(openBraceIndex, i);
}

const declaration = /export const (\w+)\s*=\s*(internalMutation|internalQuery|internalAction|mutation|query|action)\(\{/g;

const ungated = [];
const staleAllowlist = new Set(Object.keys(OPEN_BY_DESIGN));
let publicCount = 0;

for (const file of readdirSync(convexDir).sort()) {
  if (!file.endsWith(".ts") || file.startsWith("_") || SKIP_FILES.has(file)) continue;
  const source = readFileSync(path.join(convexDir, file), "utf8");
  for (const match of source.matchAll(declaration)) {
    const [, name, kind] = match;
    if (kind.startsWith("internal")) continue; // not reachable from outside
    publicCount += 1;
    const key = `${file}:${name}`;
    staleAllowlist.delete(key);
    if (key in OPEN_BY_DESIGN) continue;
    const body = bodyAfter(source, match.index + match[0].length);
    if (!GATES.some((gate) => body.includes(gate))) ungated.push({ key, kind });
  }
}

let failed = false;

if (ungated.length > 0) {
  failed = true;
  console.error(`\n✘ ${ungated.length} public Convex function(s) resolve no viewer:\n`);
  for (const { key, kind } of ungated) console.error(`    ${key}  (${kind})`);
  console.error(`
  Anyone on the internet can call these with only a document id.

  Fix: take { userId, sessionToken } and derive identity from the session —
  requireViewer(ctx, args) for "must be signed in", or
  requireProjectAccess(ctx, projectId, args) for "must be able to see this project".
  Never trust a userId argument; it is a claim, not proof.

  If a function genuinely must stay open, add it to OPEN_BY_DESIGN in
  ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} with the reason.`);
}

if (staleAllowlist.size > 0) {
  failed = true;
  console.error(`\n✘ OPEN_BY_DESIGN names ${staleAllowlist.size} function(s) that no longer exist:\n`);
  for (const key of staleAllowlist) console.error(`    ${key}`);
  console.error("\n  Remove them, so the allowlist keeps meaning what it says.");
}

if (failed) process.exit(1);

console.log(
  `✓ ${publicCount} public Convex functions checked — ` +
    `${publicCount - Object.keys(OPEN_BY_DESIGN).length} gated, ` +
    `${Object.keys(OPEN_BY_DESIGN).length} open by design.`
);

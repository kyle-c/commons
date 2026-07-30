import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Acting *as* the GitHub App, rather than only listening to it.
 *
 * Everything so far has been inbound: GitHub posts a signed webhook, we verify
 * and record it. Opening a pull request is the other direction, and it needs
 * real credentials. GitHub's scheme is two steps:
 *
 *   1. Sign a short-lived JWT with the App's private key. That proves "I am
 *      this App", and it can only read App-level metadata.
 *   2. Trade that JWT for an installation access token, scoped to one
 *      installation. That is what can touch repositories, and it expires in
 *      an hour.
 *
 * The key is never in the repo — GITHUB_APP_PRIVATE_KEY on the deployment, in
 * PKCS#8 form, because Web Crypto refuses the PKCS#1 that GitHub hands you.
 */

const GITHUB_API = "https://api.github.com";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM body to raw DER, for crypto.subtle.importKey. */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * A JWT proving we are the App. RS256, ten-minute life (GitHub's maximum),
 * with `iat` backdated a minute so a little clock drift between us and GitHub
 * cannot make a freshly minted token look like it comes from the future.
 */
async function appJwt(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const pem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId) throw new Error("GITHUB_APP_ID is not set on this deployment.");
  if (!pem) throw new Error("GITHUB_APP_PRIVATE_KEY is not set on this deployment.");
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is PKCS#1. Convert it: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key8.pem"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(
    new TextEncoder().encode(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }))
  );
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

/**
 * An installation token, which is what can actually act on repositories.
 *
 * Not cached yet. These live an hour and minting one costs an RSA signature
 * plus a round trip, so a cache is worth adding once anything calls this on a
 * hot path; opening a pull request is not that.
 */
export async function installationToken(installationId: number): Promise<string> {
  const response = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await appJwt()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`Couldn't get an installation token (${response.status}): ${await response.text()}`);
  }
  return (await response.json()).token as string;
}

/**
 * Prove the credentials work, without touching a repository.
 *
 * GET /app is the smallest call that requires a valid App JWT, so it separates
 * "the key is wrong" from "the installation is wrong" from "the request was
 * wrong" — three failures that otherwise look identical at the call site.
 */
export const verifyCredentials = internalAction({
  args: {},
  handler: async () => {
    try {
      const response = await fetch(`${GITHUB_API}/app`, {
        headers: {
          Authorization: `Bearer ${await appJwt()}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) {
        return { ok: false as const, stage: "jwt", detail: `${response.status}: ${await response.text()}` };
      }
      const app = await response.json();
      return {
        ok: true as const,
        appSlug: app.slug as string,
        appName: app.name as string,
        // What the App *declares*. An installation may still be running on an
        // older set until someone accepts the change, which is the difference
        // between "not added" and "added but not accepted".
        declaredPermissions: app.permissions ?? {},
      };
    } catch (error) {
      return { ok: false as const, stage: "signing", detail: error instanceof Error ? error.message : String(error) };
    }
  },
});

/** Exchange for an installation token and report what it can reach. */
export const verifyInstallation = internalAction({
  args: { installationId: v.number() },
  handler: async (_ctx, { installationId }) => {
    try {
      const token = await installationToken(installationId);
      const response = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) {
        return { ok: false as const, detail: `${response.status}: ${await response.text()}` };
      }
      const body = await response.json();

      // What this installation has actually accepted, which is what the token
      // can do — declared permissions mean nothing until accepted.
      const meta = await fetch(`${GITHUB_API}/app/installations/${installationId}`, {
        headers: {
          Authorization: `Bearer ${await appJwt()}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      const installation = meta.ok ? await meta.json() : null;

      return {
        ok: true as const,
        // The answer to "why didn't my deploy show up": whether this
        // installation can see the repo at all.
        repositories: (body.repositories ?? []).map((r: { full_name: string }) => r.full_name),
        acceptedPermissions: installation?.permissions ?? null,
      };
    } catch (error) {
      return { ok: false as const, detail: error instanceof Error ? error.message : String(error) };
    }
  },
});

/** Store what an installation can reach, so a query can answer without fetching. */
export const recordRepositories = internalMutation({
  args: { installationId: v.number(), repositories: v.array(v.string()) },
  handler: async (ctx, { installationId, repositories }) => {
    const row = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation", (q) => q.eq("installationId", installationId))
      .first();
    if (!row) return null;
    await ctx.db.patch(row._id, { repositories, repositoriesSyncedAt: Date.now() });
    return null;
  },
});

/**
 * Refresh the cached repo list for every live installation.
 *
 * Repo selection changes on GitHub without telling us — there is no webhook
 * for "the user ticked another repo" that we subscribe to — so this is a pull,
 * run after a connect and on demand.
 */
export const syncRepositories = internalAction({
  args: {},
  handler: async (ctx): Promise<{ installationId: number; count: number; error?: string }[]> => {
    const installations = await ctx.runQuery(internal.github.installations, {});
    const results: { installationId: number; count: number; error?: string }[] = [];
    for (const installation of installations) {
      try {
        const token = await installationToken(installation.installationId);
        const response = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!response.ok) {
          results.push({ installationId: installation.installationId, count: 0, error: `${response.status}` });
          continue;
        }
        const body = await response.json();
        const repositories: string[] = (body.repositories ?? []).map((r: { full_name: string }) => r.full_name);
        await ctx.runMutation(internal.githubApp.recordRepositories, {
          installationId: installation.installationId,
          repositories,
        });
        results.push({ installationId: installation.installationId, count: repositories.length });
      } catch (error) {
        results.push({
          installationId: installation.installationId,
          count: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  },
});

/** owner/name from any remote form, or null if it isn't a GitHub remote. */
function repoSlug(gitRemote: string): string | null {
  const match = gitRemote
    .trim()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .match(/github\.com\/([^/]+)\/([^/]+)/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Open a pull request for a draft branch, server-side.
 *
 * Ship currently walks you to GitHub's compare page, which works only if you
 * have the repo cloned and are signed in as someone who can push. This does it
 * with the installation token instead, so the loop closes for a reviewer who
 * has never cloned anything.
 *
 * Deliberately opens a PR rather than merging. GitHub owns merging: it knows
 * about required reviews, branch protection, and CI, and it reports conflicts
 * in a place engineers already look. A merge button here would have to
 * reimplement all of that and would still be wrong the first time a repo had a
 * rule we did not model.
 */
export const openPullRequest = internalAction({
  args: {
    installationId: v.number(),
    gitRemote: v.string(),
    head: v.string(),
    base: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const slug = repoSlug(args.gitRemote);
    if (!slug) return { ok: false as const, reason: "not_a_github_remote", detail: args.gitRemote };

    let token: string;
    try {
      token = await installationToken(args.installationId);
    } catch (error) {
      return { ok: false as const, reason: "no_token", detail: error instanceof Error ? error.message : String(error) };
    }

    const response = await fetch(`${GITHUB_API}/repos/${slug}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: args.title, head: args.head, base: args.base, body: args.body ?? "" }),
    });

    if (response.ok) {
      const pr = await response.json();
      return { ok: true as const, url: pr.html_url as string, number: pr.number as number };
    }

    const detail = await response.text();
    // 422 covers several distinct situations that all deserve different advice,
    // so name them rather than surfacing GitHub's raw envelope.
    if (response.status === 422 && detail.includes("A pull request already exists")) {
      return { ok: false as const, reason: "already_open", detail };
    }
    if (response.status === 422 && detail.includes("No commits between")) {
      return { ok: false as const, reason: "nothing_to_merge", detail };
    }
    if (response.status === 422 && /"field"\s*:\s*"head"/.test(detail)) {
      // The branch is not on the remote: either the draft push failed, or it
      // was deleted after merging. Distinct from "nothing to merge", where the
      // branch exists but carries no new commits.
      return { ok: false as const, reason: "branch_not_found", detail };
    }
    if (response.status === 403) {
      // The token authenticated and was refused, which almost always means the
      // App was never granted "Pull requests: read and write" — and note that
      // adding a permission is not enough on its own: each installation has to
      // accept the change before it takes effect.
      return { ok: false as const, reason: "missing_permission", detail };
    }
    if (response.status === 404) {
      // Repo selection rather than a missing repo, when permissions are fine.
      return { ok: false as const, reason: "repo_not_in_installation", detail };
    }
    return { ok: false as const, reason: "github_error", detail: `${response.status}: ${detail}` };
  },
});

/**
 * What GitHub has actually tried to send us, and what we answered.
 *
 * When a deploy goes green and nothing appears in Commons, there are two
 * stories: GitHub never sent it, or it sent and we refused. Recent Deliveries
 * in the App settings holds the answer, and the API exposes the same thing —
 * worth having here so the question takes a command rather than a browser and
 * a squint. Also reports which events the App is subscribed to, since an
 * unsubscribed event produces no delivery at all.
 */
export const recentDeliveries = internalAction({
  args: {},
  handler: async () => {
    const auth = {
      Authorization: `Bearer ${await appJwt()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    const appResponse = await fetch(`${GITHUB_API}/app`, { headers: auth });
    const events: string[] = appResponse.ok ? ((await appResponse.json()).events ?? []) : [];

    const response = await fetch(`${GITHUB_API}/app/hook/deliveries?per_page=15`, { headers: auth });
    if (!response.ok) {
      return { ok: false as const, subscribedEvents: events, detail: `${response.status}: ${await response.text()}` };
    }
    const deliveries = await response.json();
    return {
      ok: true as const,
      subscribedEvents: events,
      deliveries: (deliveries ?? []).map(
        (d: { delivered_at: string; event: string; action: string | null; status: string; status_code: number }) => ({
          at: d.delivered_at,
          event: d.action ? `${d.event}.${d.action}` : d.event,
          status: `${d.status_code} ${d.status}`,
        })
      ),
    };
  },
});

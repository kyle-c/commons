import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { accessibleProject, resolveViewer } from "./access";
import { normalizeRemote, slugifyBranch, vercelAliasCandidates } from "./github";

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
        // Where a human goes to change repo selection or accept a permission.
        // Personal and org installations live at different URLs, so we take
        // GitHub's own rather than assembling one and guessing wrong.
        manageUrl: (installation?.html_url as string | undefined) ?? null,
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

/**
 * The raw body GitHub sent for a deployment_status, so we can see what a host
 * actually reports rather than what the API docs imply.
 *
 * Branch-preview inference is fed `deployment.ref` and
 * `deployment_status.environment_url`, and on Vercel those turn out to be a
 * commit SHA and a per-deployment address — neither of which contains a branch
 * name, which is why inference correctly refuses. The question this answers is
 * whether the branch is recoverable from somewhere else in the payload.
 *
 * Returns shapes and the specific fields of interest, not the whole body: the
 * point is to learn where the branch lives, and a webhook body is not
 * something to spray into a terminal wholesale.
 */
export const inspectDeploymentDelivery = internalAction({
  args: {},
  handler: async () => {
    const auth = {
      Authorization: `Bearer ${await appJwt()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    const list = await fetch(`${GITHUB_API}/app/hook/deliveries?per_page=50`, { headers: auth });
    if (!list.ok) return { ok: false as const, detail: `${list.status}: ${await list.text()}` };

    /**
     * Delivery ids are past Number.MAX_SAFE_INTEGER (3.8e18 against a 9.0e15
     * ceiling), so JSON.parse silently rounds them and every lookup 404s on an
     * id that never existed. They have to come out of the raw text as strings.
     */
    const raw = await list.text();
    const candidates = raw
      .split(/\{"id":/)
      .slice(1)
      .map((chunk) => ({ id: chunk.match(/^\s*(\d+)/)?.[1] ?? "", chunk }))
      .filter((d) => d.id !== "" && /"event"\s*:\s*"deployment_status"/.test(d.chunk));
    if (candidates.length === 0) return { ok: false as const, detail: "no deployment_status delivery in the last 50" };

    // Try each in turn: individual deliveries expire before they drop off the
    // list, so the newest is not always the one that can still be fetched.
    let one: Response | null = null;
    const attempts: string[] = [];
    for (const candidate of candidates) {
      const response = await fetch(`${GITHUB_API}/app/hook/deliveries/${candidate.id}`, { headers: auth });
      attempts.push(`${candidate.id}:${response.status}`);
      if (response.ok) {
        one = response;
        break;
      }
    }
    if (!one) {
      return {
        ok: false as const,
        detail: `no delivery body was fetchable (${candidates.length} candidates) — ${attempts.join(", ")}`,
      };
    }
    const body = (await one.json()) as { request?: { payload?: Record<string, unknown> } };
    const payload = body.request?.payload ?? {};
    const deployment = (payload.deployment ?? {}) as Record<string, unknown>;
    const statusObj = (payload.deployment_status ?? {}) as Record<string, unknown>;

    return {
      ok: true as const,
      deliveryId: new URL(one.url).pathname.split("/").pop(),
      // Where a branch name could plausibly hide.
      deploymentKeys: Object.keys(deployment),
      deploymentRef: deployment.ref ?? null,
      deploymentEnvironment: deployment.environment ?? null,
      deploymentDescription: deployment.description ?? null,
      /** Vercel and friends stash git metadata here; free-form by design. */
      deploymentPayload: deployment.payload ?? null,
      statusKeys: Object.keys(statusObj),
      environmentUrl: statusObj.environment_url ?? null,
      targetUrl: statusObj.target_url ?? null,
      statusEnvironment: statusObj.environment ?? null,
      statusDescription: statusObj.description ?? null,
    };
  },
});

/**
 * Turn a bare commit SHA from deployment.ref into the branch it heads.
 *
 * Vercel fills deployment.ref with the SHA, not the branch, so without this
 * every sample stores junk in a column named "branch". One API call recovers
 * it. Exactly one branch must match: two branches on the same head means the
 * deploy's origin is ambiguous, and never-guess applies.
 */
export const resolveRefToBranch = internalAction({
  args: { installationId: v.number(), repoFullName: v.string(), sha: v.string() },
  handler: async (_ctx, { installationId, repoFullName, sha }) => {
    try {
      const token = await installationToken(installationId);
      const response = await fetch(`${GITHUB_API}/repos/${repoFullName}/commits/${sha}/branches-where-head`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) return null;
      const branches = (await response.json()) as { name: string }[];
      return branches.length === 1 ? branches[0].name : null;
    } catch {
      return null;
    }
  },
});

/** What confirmAliasPattern needs to know, read inside the transaction. */
export const aliasContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const samples = await ctx.db
      .query("deploymentSamples")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return {
      branchPreviewPattern: project.branchPreviewPattern ?? null,
      branchPatternSource: project.branchPatternSource ?? null,
      samples: samples
        .sort((a, b) => b.at - a.at)
        .filter((s) => !/^[0-9a-f]{40}$/.test(s.branch))
        .slice(0, 6)
        .map((s) => ({ branch: s.branch, url: s.url })),
    };
  },
});

/** Store a verified pattern, under the same provenance rules as applyDeploy. */
export const recordBranchPattern = internalMutation({
  args: { projectId: v.id("projects"), pattern: v.string() },
  handler: async (ctx, { projectId, pattern }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const canWrite = !project.branchPreviewPattern || project.branchPatternSource === "github";
    if (canWrite && project.branchPreviewPattern !== pattern) {
      await ctx.db.patch(projectId, { branchPreviewPattern: pattern, branchPatternSource: "github" });
    }
    return null;
  },
});

/**
 * When the deploy URLs themselves prove nothing, ask whether the host
 * publishes a branch alias it never reports.
 *
 * Vercel's webhook hands over "project-kxzauj7pp-team.vercel.app": a random
 * deploy id, no branch anywhere, so evidence inference rightly refuses. But
 * "project-git-{branch}-team.vercel.app" exists for every branch. The rule
 * that keeps this honest: host knowledge only generates candidates, and a
 * candidate is stored only after the constructed URL for a real, observed
 * branch actually resolves. A fabricated alias fails DNS, so resolution is a
 * hard discriminator, verified against live deploys rather than assumed. If
 * Vercel ever changes its URL shape, this degrades to refusal, never to dead
 * links.
 */
export const confirmAliasPattern = internalAction({
  args: { projectId: v.id("projects") },
  // Annotated because this action calls same-file internals, and TS refuses
  // to infer a type that would depend on itself.
  handler: async (
    ctx,
    { projectId }
  ): Promise<{ confirmed: string | null; reason?: string; checkedBranches?: string[] }> => {
    const context = await ctx.runQuery(internal.githubApp.aliasContext, { projectId });
    if (!context) return { confirmed: null, reason: "no_project" };
    if (context.branchPreviewPattern && context.branchPatternSource !== "github") {
      return { confirmed: null, reason: "manual_pattern" };
    }
    if (context.samples.length === 0) return { confirmed: null, reason: "no_samples" };

    const candidates = vercelAliasCandidates(context.samples[0].url);
    const branches = [...new Set(context.samples.map((s) => s.branch))].slice(0, 3);

    for (const candidate of candidates) {
      let allResolve = true;
      for (const branch of branches) {
        const url = candidate.replace("{branch}", slugifyBranch(branch));
        try {
          // Any HTTP answer, including a redirect to auth, proves the host
          // exists. Only a network-level failure (no such host) refutes it.
          await fetch(url, { redirect: "manual" });
        } catch {
          allResolve = false;
          break;
        }
      }
      if (allResolve) {
        await ctx.runMutation(internal.githubApp.recordBranchPattern, { projectId, pattern: candidate });
        return { confirmed: candidate, checkedBranches: branches };
      }
    }
    return { confirmed: null, reason: "no_candidate_resolved" };
  },
});

/**
 * Ask GitHub to re-send past deployment_status deliveries, so a pipeline fix
 * can be exercised against real payloads without pushing new commits.
 */
export const redeliverDeployments = internalAction({
  args: { count: v.optional(v.number()) },
  handler: async (_ctx, { count }) => {
    const auth = {
      Authorization: `Bearer ${await appJwt()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const list = await fetch(`${GITHUB_API}/app/hook/deliveries?per_page=50`, { headers: auth });
    if (!list.ok) return { redelivered: [], detail: `${list.status}` };
    // Ids exceed Number.MAX_SAFE_INTEGER; they only survive as strings.
    const raw = await list.text();
    const ids = raw
      .split(/\{"id":/)
      .slice(1)
      .filter((chunk) => /"event"\s*:\s*"deployment_status"/.test(chunk))
      .map((chunk) => chunk.match(/^\s*(\d+)/)?.[1] ?? "")
      .filter((id) => id !== "")
      .slice(0, count ?? 2);
    const redelivered: string[] = [];
    for (const id of ids) {
      const response = await fetch(`${GITHUB_API}/app/hook/deliveries/${id}/attempts`, {
        method: "POST",
        headers: auth,
      });
      if (response.ok) redelivered.push(id);
    }
    return { redelivered };
  },
});

// ── Diagnosis ──────────────────────────────────────────────────────────────

export type Finding = {
  level: "ok" | "warn" | "blocked";
  title: string;
  detail: string;
  fixLabel?: string;
  fixUrl?: string;
};

/**
 * Project facts the diagnosis needs, behind the project's own access check.
 *
 * Named for the gate it applies: an action's body cannot itself resolve a
 * viewer, so the check has to live in a query it calls, and the name is what
 * makes that delegation visible at the call site (and to
 * scripts/check-convex-auth.mjs, which reads bodies as text).
 */
export const requireProjectAccessContext = internalQuery({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, ...viewer }) => {
    const viewerId = await resolveViewer(ctx, viewer);
    const project = viewerId ? await accessibleProject(ctx, projectId, viewerId) : null;
    if (!project) return null;

    const links = project.workspaceId
      ? await ctx.db
          .query("githubWorkspaceLinks")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", project.workspaceId!))
          .collect()
      : [];
    const rows = await Promise.all(
      links.map((link) =>
        ctx.db
          .query("githubInstallations")
          .withIndex("by_installation", (q) => q.eq("installationId", link.installationId))
          .first()
      )
    );
    const samples = await ctx.db
      .query("deploymentSamples")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(20);

    return {
      hasWorkspace: Boolean(project.workspaceId),
      gitRemote: project.gitRemote ?? null,
      previewSource: project.previewSource ?? null,
      branchPreviewPattern: project.branchPreviewPattern ?? null,
      lastDeployAt: project.lastDeployAt ?? null,
      sampleCount: samples.length,
      installations: rows
        .filter((row): row is NonNullable<typeof row> => row !== null && !row.removedAt)
        .map((row) => ({ installationId: row.installationId, accountLogin: row.accountLogin })),
    };
  },
});

/** Permissions we actually depend on, and what breaks without each. */
const NEEDED_PERMISSIONS: { key: string; accepts: string[]; blocks: boolean; why: string }[] = [
  { key: "deployments", accepts: ["read", "write"], blocks: true, why: "hear about your deploys" },
  { key: "contents", accepts: ["read", "write"], blocks: true, why: "read your branches" },
  { key: "pull_requests", accepts: ["write"], blocks: false, why: "open pull requests for you" },
];

/**
 * Everything that can break between "I connected GitHub" and "my preview
 * updated", asked in one pass.
 *
 * Shipping this connection took an afternoon, and all four causes presented
 * identically inside Commons: an empty preview field. The repo sat outside the
 * installation. The installation had not *accepted* a permission the App
 * declared. The App was subscribed to no events at all, so nothing was ever
 * dispatched. The webhook URL was an apex domain that answers POST with 405.
 * Telling those apart needed an App JWT and a terminal.
 *
 * Order is the product here, not coverage. Findings come back worst-first and
 * the first blocking one is the answer: later checks usually fail *because* of
 * an earlier one, so a list of five problems would be four lies. Each blocking
 * finding carries the link to the page that fixes it.
 *
 * An action, not a query: it calls GitHub, and it is invoked by a button
 * rather than rendered, so it is allowed to refuse.
 */
export const diagnose = action({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ findings: Finding[]; checkedAt: number }> => {
    const context = await ctx.runQuery(internal.githubApp.requireProjectAccessContext, args);
    if (!context) throw new Error("You do not have access to this project.");

    const findings: Finding[] = [];
    const done = (extra: Finding[] = []) => ({ findings: [...findings, ...extra], checkedAt: Date.now() });

    // 1. Is there anything to receive events at all?
    if (!context.hasWorkspace) {
      return done([
        {
          level: "blocked",
          title: "This project is not in a workspace",
          detail: "GitHub connects to a workspace, so a project outside one has nothing to receive deploys through.",
        },
      ]);
    }
    if (context.installations.length === 0) {
      return done([
        {
          level: "blocked",
          title: "GitHub is not connected to this workspace",
          detail: "Connect an account and pick this project's repository. Nothing arrives until then.",
        },
      ]);
    }
    const accounts = context.installations.map((i) => i.accountLogin).join(" and ");
    findings.push({
      level: "ok",
      title: `Connected to ${accounts}`,
      detail: `${context.installations.length} GitHub installation${context.installations.length === 1 ? "" : "s"} linked to this workspace.`,
    });

    // 2. Can we still act as the App, and what can each installation see?
    const installations = await Promise.all(
      context.installations.map(async (row) => ({
        ...row,
        result: await ctx.runAction(internal.githubApp.verifyInstallation, { installationId: row.installationId }),
      }))
    );
    const broken = installations.filter((row) => !row.result.ok);
    if (broken.length === installations.length) {
      return done([
        {
          level: "blocked",
          title: "Commons cannot authenticate to GitHub",
          detail:
            "The App credentials are rejected, so no check below can run. This is a Commons configuration problem, not something in your repo. " +
            (broken[0]?.result.ok === false ? broken[0].result.detail : ""),
        },
      ]);
    }

    // 3. Is this project's repo inside one of those installations?
    if (!context.gitRemote) {
      findings.push({
        level: "blocked",
        title: "This project has no GitHub repository",
        detail:
          "Commons matches an incoming deploy to a project by comparing remote URLs, so with no remote set it cannot tell which deploys are yours.",
      });
      return done();
    }
    const wanted = normalizeRemote(context.gitRemote);
    const repoName = context.gitRemote.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");
    const reachable = installations.flatMap((row) => (row.result.ok ? row.result.repositories : []));
    const covered = reachable.some((full) => {
      const candidate = normalizeRemote(`https://github.com/${full}`);
      return candidate === wanted || wanted.endsWith(`/${full.toLowerCase()}`);
    });
    const manageUrl = installations.find((row) => row.result.ok && row.result.manageUrl);
    const manage =
      manageUrl && manageUrl.result.ok && manageUrl.result.manageUrl ? manageUrl.result.manageUrl : undefined;
    if (!covered) {
      return done([
        {
          level: "blocked",
          title: `${repoName} is not in the GitHub installation`,
          detail:
            `${accounts} is connected, but this repository is not one of the ${reachable.length} it can see. ` +
            "GitHub only sends events for selected repositories, so its deploys never leave GitHub. Add it under Configure → Repository access.",
          fixLabel: "Configure on GitHub",
          fixUrl: manage,
        },
      ]);
    }
    findings.push({
      level: "ok",
      title: `${repoName} is in the installation`,
      detail: `One of ${reachable.length} repositories this connection can see.`,
    });

    // 4. Declared is not accepted. A permission added after someone installed
    //    the App stays pending until they approve it, and the token simply
    //    does not have it in the meantime.
    const accepted = installations.find((row) => row.result.ok && row.result.acceptedPermissions);
    const permissions: Record<string, string> =
      (accepted && accepted.result.ok ? (accepted.result.acceptedPermissions as Record<string, string>) : null) ?? {};
    const missing = NEEDED_PERMISSIONS.filter((need) => !need.accepts.includes(permissions[need.key] ?? ""));
    for (const need of missing) {
      findings.push({
        level: need.blocks ? "blocked" : "warn",
        title: `GitHub has not granted "${need.key}"`,
        detail:
          `Commons needs it to ${need.why}. A permission the App asks for stays pending until someone with access to ` +
          `${accounts} approves it, and until then the connection behaves as though it were never requested.`,
        fixLabel: "Review on GitHub",
        fixUrl: manage,
      });
    }
    if (missing.some((need) => need.blocks)) return done();

    // 5. Is the App subscribed to the event this all depends on, and is
    //    GitHub's delivery of it actually landing?
    const hook = await ctx.runAction(internal.githubApp.recentDeliveries, {});
    if (!hook.subscribedEvents.includes("deployment_status")) {
      return done([
        {
          level: "blocked",
          title: "Commons is not subscribed to deploy events",
          detail:
            "The App is not subscribed to deployment_status on GitHub, so no deploy is ever dispatched to Commons, no matter how the repository is set up. This is a Commons configuration problem, not something in your repo.",
        },
      ]);
    }
    const deliveries: { at: string; event: string; status: string }[] = hook.ok ? hook.deliveries : [];
    const failures = deliveries.filter((d) => !/^2\d\d/.test(d.status));
    if (deliveries.length > 0 && failures.length === deliveries.length) {
      return done([
        {
          level: "blocked",
          title: "GitHub cannot deliver to Commons",
          detail:
            `The last ${deliveries.length} deliveries all failed with ${failures[0].status}. Events are being sent and rejected, ` +
            "which points at the webhook endpoint rather than at your repository. This is a Commons configuration problem.",
        },
      ]);
    }
    findings.push({
      level: "ok",
      title: "GitHub is delivering events",
      detail:
        deliveries.length === 0
          ? "Subscribed to deployment_status. No deliveries recorded yet."
          : `${deliveries.length - failures.length} of the last ${deliveries.length} deliveries succeeded.`,
    });

    // 6. Everything above is green, so the remaining question is whether a
    //    deploy has actually happened.
    if (context.lastDeployAt) {
      findings.push({
        level: "ok",
        title: "Preview link is coming from your deploys",
        detail: `Last production deploy arrived ${new Date(context.lastDeployAt).toISOString()}.`,
      });
    } else {
      findings.push({
        level: "warn",
        title: "No deploy has reached Commons yet",
        detail:
          "The connection checks out, so the likely answer is that nothing has deployed since you connected, or your host is not reporting deploys to GitHub. " +
          "Commons only sees what GitHub is told about: a Vercel or Netlify build that fails, or is not linked to this repository, never becomes an event. Push a commit to your default branch.",
      });
    }

    // 7. Branch previews are learned from evidence, and two samples is the
    //    minimum that can prove a pattern rather than fit one point.
    if (context.branchPreviewPattern) {
      findings.push({
        level: "ok",
        title: "Branch previews are understood",
        detail: `Commons can work out the preview URL for any branch from ${context.sampleCount} observed deploys.`,
      });
    } else if (context.sampleCount < 2) {
      findings.push({
        level: "warn",
        title: "Branch previews not learned yet",
        detail:
          `Commons has seen ${context.sampleCount} branch deploy${context.sampleCount === 1 ? "" : "s"} for this project and needs at least 2 ` +
          "before it will guess a per-branch URL pattern. This is expected on a new connection, and production previews work regardless.",
      });
    } else {
      // Samples exist and inference still refused, which is a different
      // situation entirely: waiting longer will not help. Saying "needs at
      // least 2" here would be a lie that never resolves.
      findings.push({
        level: "warn",
        title: "Branch preview URLs don't contain the branch name",
        detail:
          `Commons has ${context.sampleCount} branch deploys for this project but could not prove a pattern: the URLs your host reports ` +
          "are per-deployment addresses with a random id, and no published alias for this host could be verified against a real deploy. " +
          "It refuses to guess rather than store dead links. Paste the pattern yourself under Draft previews, using {branch} where the name goes.",
      });
    }

    return done();
  },
});

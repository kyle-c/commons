import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * The GitHub App listener: Commons learns each project's preview URL and its
 * per-branch preview pattern by watching deployment_status events, instead of
 * asking a human to paste them.
 *
 * The governing rule is: never guess. A learned value is only written when it
 * is provable from the evidence, and a human's manual value is never
 * overwritten. Provenance is recorded on the project (previewSource,
 * branchPatternSource) so the two can always be told apart.
 */

// ── Pure helpers (no db access, so they stay easy to reason about) ──────────

/** Compare git remotes across ssh/https, .git suffixes, and case. */
export function normalizeRemote(remote: string): string {
  return remote
    .trim()
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * How hosts render a branch name inside a hostname. Vercel and Netlify both
 * lowercase and replace anything outside [a-z0-9] with a hyphen.
 */
export function slugifyBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface DeploySample {
  branch: string;
  url: string;
}

/**
 * Infer a "{branch}"-templated preview URL from observed deploys.
 *
 * The pattern is accepted only when filling it with each sample's own branch
 * reproduces that sample's URL exactly, for every sample we hold. One
 * disagreeing observation is enough to reject, which is what keeps a wrong
 * pattern from ever reaching a project. Returns null when unprovable.
 */
export function inferBranchPattern(samples: DeploySample[]): string | null {
  const distinct = new Map<string, DeploySample>();
  for (const s of samples) {
    if (!s.branch || !s.url) continue;
    if (!distinct.has(s.branch)) distinct.set(s.branch, s);
  }
  const unique = [...distinct.values()];
  if (unique.length < 2) return null; // one deploy proves nothing

  // Anchor on the first sample: wherever its slug appears is a candidate
  // split. Multiple occurrences means multiple candidates, so try each.
  const anchor = unique[0];
  const anchorSlug = slugifyBranch(anchor.branch);
  if (!anchorSlug) return null;

  for (let from = 0; ; ) {
    const at = anchor.url.indexOf(anchorSlug, from);
    if (at === -1) break;
    from = at + 1;
    const prefix = anchor.url.slice(0, at);
    const suffix = anchor.url.slice(at + anchorSlug.length);
    const candidate = `${prefix}{branch}${suffix}`;
    const holds = unique.every(
      (s) => candidate.replace("{branch}", slugifyBranch(s.branch)) === s.url
    );
    if (holds) return candidate;
  }
  return null;
}

/** A deploy that represents the live product, not a branch preview. */
export function isProductionDeploy(environment: string | undefined, ref: string, defaultBranch: string): boolean {
  const env = (environment ?? "").toLowerCase();
  if (env.includes("preview") || env.includes("staging")) return false;
  return env.includes("production") || ref === defaultBranch;
}

// ── Installations ──────────────────────────────────────────────────────────

export const recordInstallation = internalMutation({
  args: {
    installationId: v.number(),
    accountLogin: v.string(),
    removed: v.optional(v.boolean()),
  },
  handler: async (ctx, { installationId, accountLogin, removed }) => {
    const existing = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation", (q) => q.eq("installationId", installationId))
      .unique();
    if (removed) {
      if (existing) await ctx.db.patch(existing._id, { removedAt: Date.now() });
      return null;
    }
    if (existing) {
      await ctx.db.patch(existing._id, { accountLogin, removedAt: undefined });
    } else {
      await ctx.db.insert("githubInstallations", { installationId, accountLogin });
    }
    return null;
  },
});

export const installations = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("githubInstallations").collect()).filter((i) => !i.removedAt),
});

// ── Deployments ────────────────────────────────────────────────────────────

/**
 * A successful deployment landed. Match it to projects by git remote, then
 * learn what it proves: the production URL, or another (branch -> url) sample
 * for pattern inference. Snapshots are marked stale so a client can refresh
 * them (Phase 2).
 */
export const handleDeployment = internalMutation({
  args: {
    repoUrls: v.array(v.string()), // html_url, clone_url, ssh_url, full_name
    branch: v.string(),
    defaultBranch: v.string(),
    environment: v.optional(v.string()),
    environmentUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const url = args.environmentUrl.replace(/\/+$/, "");
    if (!/^https?:\/\/.+/.test(url)) return { matched: 0 };

    const wanted = new Set(args.repoUrls.map(normalizeRemote));
    const projects = (await ctx.db.query("projects").collect()).filter((p) => {
      if (!p.gitRemote || p.archivedAt) return false;
      const mine = normalizeRemote(p.gitRemote);
      // full_name ("kyle-c/commons") matches the tail of a remote URL too.
      return [...wanted].some((w) => w === mine || mine.endsWith(`/${w}`) || w.endsWith(mine));
    });
    if (projects.length === 0) return { matched: 0 };

    const production = isProductionDeploy(args.environment, args.branch, args.defaultBranch);
    for (const project of projects) {
      await applyDeploy(ctx, project, { url, branch: args.branch, production, environment: args.environment });
    }
    return { matched: projects.length };
  },
});

async function applyDeploy(
  ctx: { db: any },
  project: Doc<"projects">,
  deploy: { url: string; branch: string; production: boolean; environment?: string }
): Promise<void> {
  const patch: Record<string, unknown> = {};

  if (deploy.production) {
    // A human's preview URL is a decision, not a guess: never overwrite it.
    const canWrite = !project.previewUrl || project.previewSource === "github";
    if (canWrite && project.previewUrl !== deploy.url) {
      patch.previewUrl = deploy.url;
      patch.previewSource = "github";
    }
    patch.lastDeployAt = Date.now();
    // Deployed pixels moved; existing snapshots are now older than the app.
    patch.snapshotsStaleAt = Date.now();
  } else {
    // Branch deploy: another data point for the pattern.
    await ctx.db.insert("deploymentSamples", {
      projectId: project._id,
      branch: deploy.branch,
      url: deploy.url,
      environment: deploy.environment,
      at: Date.now(),
    });
    const samples = await ctx.db
      .query("deploymentSamples")
      .withIndex("by_project", (q: any) => q.eq("projectId", project._id))
      .collect();
    // Keep the window small: recent deploys describe the current host setup.
    const recent = samples.sort((a: any, b: any) => b.at - a.at).slice(0, 12);
    const pattern = inferBranchPattern(recent.map((s: any) => ({ branch: s.branch, url: s.url })));
    const canWrite = !project.branchPreviewPattern || project.branchPatternSource === "github";
    if (pattern && canWrite && project.branchPreviewPattern !== pattern) {
      patch.branchPreviewPattern = pattern;
      patch.branchPatternSource = "github";
    }
    // Drop anything beyond the window so the table cannot grow without bound.
    for (const stale of samples.filter((s: any) => !recent.includes(s))) {
      await ctx.db.delete(stale._id);
    }
  }

  if (Object.keys(patch).length > 0) await ctx.db.patch(project._id, patch);
}

/** Projects whose snapshots a client should refresh, newest staleness first. */
export const staleSnapshotProjects = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("projects").collect())
      .filter((p) => p.snapshotsStaleAt && p.previewUrl && !p.archivedAt)
      .map((p) => ({ projectId: p._id as Id<"projects">, staleAt: p.snapshotsStaleAt! })),
});

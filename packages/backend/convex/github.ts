import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { accessibleProject, requireViewer, resolveViewer } from "./access";

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

// ── Connecting an installation to a workspace ──────────────────────────────

/**
 * The binding problem: the App is registered once for the whole product, and a
 * GitHub account installs it once. Neither of those facts says which Commons
 * workspace the resulting deploy events belong to. Without an explicit link,
 * matching a deploy to a project by git remote alone would let one workspace's
 * deploys write into another workspace's projects.
 *
 * So a workspace member starts the connect, we mint a single-use state token
 * tied to (workspace, user), GitHub hands that token back to our Setup URL
 * alongside the installation_id, and only then is the pair bound. The token is
 * what makes the redirect trustworthy: an installation_id on its own is a
 * public number that anyone could guess or replay.
 */

const STATE_TTL_MS = 15 * 60 * 1000;

function newStateToken(): string {
  // Math.random is fine here: Convex mutations replay deterministically, and
  // the token's job is unguessability within a 15-minute window, not secrecy
  // at rest. 48 chars of base36 is far past what a redirect can be brute-forced for.
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 14)).join("");
}

async function isWorkspaceMember(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">
): Promise<boolean> {
  const membership = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user_workspace", (q) => q.eq("userId", userId).eq("workspaceId", workspaceId))
    .unique();
  return membership !== null;
}

/**
 * Step 1 of the connect: hand back the URL to send the person to. The state
 * token rides along in the query string and comes back on the Setup URL.
 */
export const startConnect = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    if (!userId || !(await isWorkspaceMember(ctx, args.workspaceId, userId))) {
      return { ok: false as const, reason: "not_allowed" };
    }
    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) return { ok: false as const, reason: "app_not_configured" };

    const token = newStateToken();
    await ctx.db.insert("githubConnectStates", {
      token,
      workspaceId: args.workspaceId,
      userId,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    return {
      ok: true as const,
      url: `https://github.com/apps/${slug}/installations/new?state=${token}`,
    };
  },
});

/**
 * Step 2: GitHub redirected to our Setup URL. Bind, but only on proof.
 *
 * Returns a reason rather than throwing, because the caller is an HTTP action
 * rendering a page for a human who needs to be told what to do next.
 */
export const completeConnect = internalMutation({
  args: {
    state: v.string(),
    installationId: v.number(),
    accountLogin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("githubConnectStates")
      .withIndex("by_token", (q) => q.eq("token", args.state))
      .first();
    if (!row) return { ok: false as const, reason: "unknown_state" };
    if (row.usedAt) return { ok: false as const, reason: "already_used" };
    if (row.expiresAt < Date.now()) return { ok: false as const, reason: "expired" };

    const workspace = await ctx.db.get(row.workspaceId);
    if (!workspace) return { ok: false as const, reason: "unknown_workspace" };

    // Re-check membership at redemption: someone removed from the workspace
    // between clicking Connect and finishing on GitHub must not bind it.
    if (!(await isWorkspaceMember(ctx, row.workspaceId, row.userId))) {
      return { ok: false as const, reason: "not_allowed" };
    }

    const existing = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation", (q) => q.eq("installationId", args.installationId))
      .first();
    const accountLogin = args.accountLogin ?? existing?.accountLogin ?? "unknown";
    if (existing) {
      await ctx.db.patch(existing._id, { accountLogin, installedBy: row.userId, removedAt: undefined });
    } else {
      await ctx.db.insert("githubInstallations", {
        installationId: args.installationId,
        accountLogin,
        installedBy: row.userId,
      });
    }

    // Add a link rather than moving one: the same GitHub account legitimately
    // feeds several workspaces, and reassigning silently stopped deploys
    // reaching whichever workspace connected first.
    const alreadyLinked = await ctx.db
      .query("githubWorkspaceLinks")
      .withIndex("by_installation_workspace", (q) =>
        q.eq("installationId", args.installationId).eq("workspaceId", row.workspaceId)
      )
      .first();
    if (!alreadyLinked) {
      await ctx.db.insert("githubWorkspaceLinks", {
        installationId: args.installationId,
        workspaceId: row.workspaceId,
        linkedBy: row.userId,
      });
    }

    await ctx.db.patch(row._id, { usedAt: Date.now() });
    // Whether anything actually changed. Reconnecting the same account is a
    // no-op, and a no-op that looks identical to success is how two connects
    // both landed on one account without anyone noticing.
    return {
      ok: true as const,
      workspaceName: workspace.name,
      accountLogin,
      alreadyLinked: Boolean(alreadyLinked),
    };
  },
});

/**
 * Unbind an installation from this workspace. Deliberately does not uninstall
 * the App on GitHub — revoking someone's repo access is their call to make on
 * GitHub, not a side effect of a click in here.
 */
export const disconnect = mutation({
  args: {
    installationRowId: v.id("githubInstallations"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireViewer(ctx, args);
    const row = await ctx.db.get(args.installationRowId);
    if (!row || !(await isWorkspaceMember(ctx, args.workspaceId, userId))) throw new Error("Not allowed");
    // Only this workspace's link goes; other workspaces keep theirs.
    const link = await ctx.db
      .query("githubWorkspaceLinks")
      .withIndex("by_installation_workspace", (q) =>
        q.eq("installationId", row.installationId).eq("workspaceId", args.workspaceId)
      )
      .first();
    if (link) await ctx.db.delete(link._id);
    return null;
  },
});

/**
 * What GitHub is doing for this project, in the project's own terms.
 *
 * A project connected to GitHub that has never had a successful deploy looks
 * exactly like one that was never connected: an empty preview field either
 * way. That ambiguity cost an afternoon of debugging on a repo whose Vercel
 * deploys had been blocked for a week, so the two states are now nameable.
 *
 * Degrades to null rather than throwing — it is rendered.
 */
export const projectStatus = query({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, ...viewer }) => {
    const viewerId = await resolveViewer(ctx, viewer);
    const project = viewerId ? await accessibleProject(ctx, projectId, viewerId) : null;
    if (!project?.workspaceId) return null;

    const links = await ctx.db
      .query("githubWorkspaceLinks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", project.workspaceId!))
      .collect();
    const installs = await Promise.all(
      links.map((link) =>
        ctx.db
          .query("githubInstallations")
          .withIndex("by_installation", (q) => q.eq("installationId", link.installationId))
          .first()
      )
    );
    const accounts = installs
      .filter((row): row is NonNullable<typeof row> => row !== null && !row.removedAt)
      .map((row) => row.accountLogin);

    const samples = await ctx.db
      .query("deploymentSamples")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(1);

    return {
      accounts,
      // Any deploy we have ever acted on for this project: a production one
      // stamps lastDeployAt, a branch one leaves a sample.
      seenDeploy: Boolean(project.lastDeployAt) || samples.length > 0,
      lastDeployAt: project.lastDeployAt,
    };
  },
});

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
 *
 * Matching is scoped to the workspace the installation is bound to. A git
 * remote is not a secret, so remote-only matching would let anyone who can
 * deploy a fork write a preview URL into a stranger's project.
 */
export const handleDeployment = internalMutation({
  args: {
    installationId: v.number(),
    repoUrls: v.array(v.string()), // html_url, clone_url, ssh_url, full_name
    branch: v.string(),
    defaultBranch: v.string(),
    environment: v.optional(v.string()),
    environmentUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const url = args.environmentUrl.replace(/\/+$/, "");
    if (!/^https?:\/\/.+/.test(url)) return { matched: 0, reason: "bad_url" };

    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation", (q) => q.eq("installationId", args.installationId))
      .first();
    // Installed but never connected to a workspace: nothing to write into yet.
    // The row still exists, so the UI can offer to finish the connect.
    if (!installation || installation.removedAt) return { matched: 0, reason: "unknown_installation" };

    // Every workspace this installation feeds, not just one.
    const links = await ctx.db
      .query("githubWorkspaceLinks")
      .withIndex("by_installation", (q) => q.eq("installationId", args.installationId))
      .collect();
    const workspaceIds = new Set<string>(links.map((l) => l.workspaceId));
    if (workspaceIds.size === 0) return { matched: 0, reason: "unbound_installation" };

    const wanted = new Set(args.repoUrls.map(normalizeRemote));
    const projects = (await ctx.db.query("projects").collect()).filter((p) => {
      if (!p.gitRemote || p.archivedAt) return false;
      if (!p.workspaceId || !workspaceIds.has(p.workspaceId)) return false;
      const mine = normalizeRemote(p.gitRemote);
      // full_name ("kyle-c/commons") matches the tail of a remote URL too.
      return [...wanted].some((w) => w === mine || mine.endsWith(`/${w}`) || w.endsWith(mine));
    });
    if (projects.length === 0) return { matched: 0, reason: "no_project" };

    const production = isProductionDeploy(args.environment, args.branch, args.defaultBranch);
    for (const project of projects) {
      await applyDeploy(ctx, project, { url, branch: args.branch, production, environment: args.environment });
    }
    return { matched: projects.length };
  },
});

async function applyDeploy(
  ctx: MutationCtx,
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
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    // Keep the window small: recent deploys describe the current host setup.
    const recent = samples.sort((a, b) => b.at - a.at).slice(0, 12);
    const pattern = inferBranchPattern(recent.map((s) => ({ branch: s.branch, url: s.url })));
    const canWrite = !project.branchPreviewPattern || project.branchPatternSource === "github";
    if (pattern && canWrite && project.branchPreviewPattern !== pattern) {
      patch.branchPreviewPattern = pattern;
      patch.branchPatternSource = "github";
    }
    // Drop anything beyond the window so the table cannot grow without bound.
    for (const stale of samples.filter((s) => !recent.includes(s))) {
      await ctx.db.delete(stale._id);
    }
  }

  if (Object.keys(patch).length > 0) await ctx.db.patch(project._id, patch);
}

/**
 * Carry pre-many-to-many bindings into the link table.
 *
 * githubInstallations.workspaceId held a single binding, and re-connecting
 * overwrote it. Anything still sitting in that field is a real link someone
 * made, so it becomes a row here; the field is left in place, unread, rather
 * than dropped mid-flight.
 */
export const migrateBindings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const installs = await ctx.db.query("githubInstallations").collect();
    let created = 0;
    for (const install of installs) {
      if (!install.workspaceId) continue;
      const existing = await ctx.db
        .query("githubWorkspaceLinks")
        .withIndex("by_installation_workspace", (q) =>
          q.eq("installationId", install.installationId).eq("workspaceId", install.workspaceId!)
        )
        .first();
      if (existing) continue;
      await ctx.db.insert("githubWorkspaceLinks", {
        installationId: install.installationId,
        workspaceId: install.workspaceId,
        linkedBy: install.installedBy ?? install.workspaceId as unknown as Id<"users">,
      });
      created += 1;
    }
    return { created };
  },
});

/**
 * Link an installation to a workspace directly, for repair.
 *
 * The connect flow is how this normally happens. This exists because the
 * single-workspaceId model silently discarded a link when the same account was
 * connected from a second workspace, and the lost link has to be put back
 * without asking the person to redo a step they already did correctly.
 */
export const linkWorkspace = internalMutation({
  args: {
    installationId: v.number(),
    workspaceId: v.id("workspaces"),
    linkedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubWorkspaceLinks")
      .withIndex("by_installation_workspace", (q) =>
        q.eq("installationId", args.installationId).eq("workspaceId", args.workspaceId)
      )
      .first();
    if (existing) return { created: false as const };
    await ctx.db.insert("githubWorkspaceLinks", args);
    return { created: true as const };
  },
});

/**
 * What would a deploy from this installation match, and if nothing, why?
 *
 * Read-only. When a deploy doesn't show up, the question is always "is it us
 * or is it GitHub", and answering it by firing a real webhook writes to
 * someone's project. This walks the same matching logic and reports.
 */
export const diagnoseDeploy = internalQuery({
  args: { installationId: v.number(), repoUrl: v.string() },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query("githubInstallations")
      .withIndex("by_installation", (q) => q.eq("installationId", args.installationId))
      .first();
    if (!installation) return { ok: false as const, reason: "no such installation" };
    if (installation.removedAt) return { ok: false as const, reason: "installation was removed" };

    const links = await ctx.db
      .query("githubWorkspaceLinks")
      .withIndex("by_installation", (q) => q.eq("installationId", args.installationId))
      .collect();
    if (links.length === 0) return { ok: false as const, reason: "installation is not linked to any workspace" };
    const workspaceIds = new Set<string>(links.map((l) => l.workspaceId));

    const wanted = normalizeRemote(args.repoUrl);
    const all = await ctx.db.query("projects").collect();
    const sameRemote = all.filter((p) => {
      if (!p.gitRemote) return false;
      const mine = normalizeRemote(p.gitRemote);
      return mine === wanted || mine.endsWith(`/${wanted}`) || wanted.endsWith(mine);
    });
    const matched = sameRemote.filter((p) => !p.archivedAt && p.workspaceId && workspaceIds.has(p.workspaceId));
    return {
      ok: matched.length > 0,
      account: installation.accountLogin,
      linkedWorkspaces: links.length,
      projectsWithThisRemote: sameRemote.map((p) => ({
        name: p.name,
        archived: Boolean(p.archivedAt),
        workspaceLinked: Boolean(p.workspaceId && workspaceIds.has(p.workspaceId)),
      })),
      wouldMatch: matched.map((p) => p.name),
    };
  },
});

/** Projects whose snapshots a client should refresh, newest staleness first. */
export const staleSnapshotProjects = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("projects").collect())
      .filter((p) => p.snapshotsStaleAt && p.previewUrl && !p.archivedAt)
      .map((p) => ({ projectId: p._id as Id<"projects">, staleAt: p.snapshotsStaleAt! })),
});

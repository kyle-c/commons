import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { accessibleProject, requireViewer, resolveViewer, randomToken, isWorkspaceMember } from "./access";
import { internal } from "./_generated/api";
import { normalizeRemote, slugifyBranch, inferBranchPattern, vercelAliasCandidates, isProductionDeploy, chooseAutoWorkspace } from "./previewLogic";
import type { DeploySample } from "./previewLogic";

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

// ── Pure helpers ───────────────────────────────────────────────────────────
// Extracted to previewLogic.ts (dependency-free, unit-tested). Re-exported
// here so existing importers of "./github" are unaffected.
export {
  normalizeRemote,
  slugifyBranch,
  inferBranchPattern,
  vercelAliasCandidates,
  isProductionDeploy,
  type DeploySample,
} from "./previewLogic";

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
  return randomToken(24);
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
    const live = installs.filter((row): row is NonNullable<typeof row> => row !== null && !row.removedAt);
    const accounts = live.map((row) => row.accountLogin);

    /**
     * Is this project's repo actually inside one of those installations?
     *
     * "Only select repositories" is the default people click through, and a
     * repo left out of it produces exactly the same silence as a repo that has
     * never deployed. Distinguishing them by hand took an afternoon and an App
     * token; this makes it a sentence.
     *
     * Null when nothing has synced yet, so a stale cache never accuses a repo
     * of being uncovered when we simply do not know.
     */
    const synced = live.filter((row) => row.repositories !== undefined);
    let repoCovered: boolean | null = null;
    if (project.gitRemote && synced.length > 0) {
      const wanted = normalizeRemote(project.gitRemote);
      repoCovered = synced.some((row) =>
        (row.repositories ?? []).some((full) => {
          const candidate = normalizeRemote(`https://github.com/${full}`);
          return candidate === wanted || wanted.endsWith(`/${full.toLowerCase()}`);
        })
      );
    }

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
      repoCovered,
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
    sha: v.optional(v.string()),
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
    const matchesRepo = (p: Doc<"projects">): boolean => {
      if (!p.gitRemote || !p.workspaceId || !workspaceIds.has(p.workspaceId)) return false;
      const mine = normalizeRemote(p.gitRemote);
      // full_name ("kyle-c/commons") matches the tail of a remote URL too.
      return [...wanted].some((w) => w === mine || mine.endsWith(`/${w}`) || w.endsWith(mine));
    };
    const allProjects = await ctx.db.query("projects").collect();
    let projects = allProjects.filter((p) => !p.archivedAt && matchesRepo(p));

    const production = isProductionDeploy(args.environment, args.branch, args.defaultBranch);

    if (projects.length === 0) {
      // The zero-setup door (2026-08-02): a production deploy for a covered
      // repo that has no project *becomes* one, so connecting GitHub is the
      // whole setup. Guarded three ways, each a refusal to guess:
      // - production deploys only — a branch preview is not a product;
      // - an archived match means the humans put this repo away, and a
      //   tombstone row means they deleted it — both verdicts stand;
      // - the workspace must be unambiguous (one team, or one total), or
      //   the deploy is dropped as ambiguous rather than landed somewhere.
      if (!production) return { matched: 0, reason: "no_project" };
      if (allProjects.some(matchesRepo)) return { matched: 0, reason: "archived_project" };
      const repoFullName =
        args.repoUrls.find((u) => /^[^/]+\/[^/]+$/.test(u)) ?? normalizeRemote(args.repoUrls[0] ?? "");
      // A payload with no usable repo identity must not become a project
      // named "" with a "" tombstone — refuse, as everywhere else here.
      if (!repoFullName) return { matched: 0, reason: "no_repo_identity" };
      const tombstone = await ctx.db
        .query("githubAutoProjects")
        .withIndex("by_install_repo", (q) =>
          q.eq("installationId", args.installationId).eq("repoFullName", repoFullName)
        )
        .first();
      if (tombstone) return { matched: 0, reason: "previously_offered" };

      const linkRows = await Promise.all(
        links.map(async (l) => ({ link: l, workspace: await ctx.db.get(l.workspaceId) }))
      );
      const workspaceId = chooseAutoWorkspace(
        linkRows
          .filter((r) => r.workspace)
          .map((r) => ({ workspaceId: r.link.workspaceId, kind: r.workspace!.kind }))
      ) as Id<"workspaces"> | null;
      if (!workspaceId) return { matched: 0, reason: "ambiguous_workspace" };

      // Attributed to whoever connected this workspace's GitHub — a real
      // member who chose to open this door, never a synthetic user.
      const creator = links.find((l) => l.workspaceId === workspaceId)?.linkedBy;
      if (!creator) return { matched: 0, reason: "ambiguous_workspace" };

      const gitRemote =
        args.repoUrls.find((u) => u.startsWith("https://")) ?? `https://github.com/${repoFullName}`;
      const projectId = await ctx.db.insert("projects", {
        name: repoFullName.split("/").pop() ?? repoFullName,
        createdBy: creator,
        workspaceId,
        visibility: "team",
        gitRemote,
      });
      // One frame — the deployed root — so the canvas opens as the product,
      // not a void. Route discovery fills in the rest when someone with the
      // repo opens the project; the snapshot pipeline fills the pixels from
      // the deploy meanwhile.
      await ctx.db.insert("frames", {
        projectId,
        kind: "route",
        title: "Home",
        routePath: "/",
        x: 120,
        y: 120,
        width: 1280,
        height: 800,
      });
      await ctx.db.insert("githubAutoProjects", { installationId: args.installationId, repoFullName, projectId });
      const created = await ctx.db.get(projectId);
      if (!created) return { matched: 0, reason: "create_failed" };
      projects = [created];
      // Fall through: the deploy that created the project also applies to it,
      // so previewUrl, the deploy log, and snapshot staleness all land in the
      // same transaction and the card is live from its first second.
    }
    for (const project of projects) {
      await applyDeploy(ctx, project, {
        url,
        branch: args.branch,
        sha: args.sha,
        production,
        environment: args.environment,
      });
    }
    return { matched: projects.length };
  },
});

async function applyDeploy(
  ctx: MutationCtx,
  project: Doc<"projects">,
  deploy: { url: string; branch: string; sha?: string; production: boolean; environment?: string }
): Promise<void> {
  const patch: Record<string, unknown> = {};

  // The log is unconditional: history that only remembers some deploys reads
  // as history with holes. Capped so the table cannot grow without bound.
  await ctx.db.insert("deploys", {
    projectId: project._id,
    at: Date.now(),
    production: deploy.production,
    environment: deploy.environment,
    branch: deploy.branch,
    sha: deploy.sha,
    url: deploy.url,
  });
  const logged = await ctx.db
    .query("deploys")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  if (logged.length > 50) {
    for (const old of logged.sort((a, b) => a.at - b.at).slice(0, logged.length - 50)) {
      await ctx.db.delete(old._id);
    }
  }

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
  } else if (/^[0-9a-f]{40}$/.test(deploy.branch)) {
    // The webhook could not resolve this ref to a branch name, so it is a
    // bare commit SHA. A sample whose "branch" is a SHA can never support a
    // pattern and would poison the ones that could, so it is not stored.
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
    } else if (!pattern && canWrite) {
      // The URLs themselves prove nothing, but the host may publish a branch
      // alias it never reports. That check needs fetch, which a mutation does
      // not have, so it runs as a follow-up action. Same provenance rules
      // apply on write, and nothing is stored unless a real branch resolves.
      await ctx.scheduler.runAfter(0, internal.githubApp.confirmAliasPattern, { projectId: project._id });
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

/**
 * Delete samples recorded before the webhook learned to resolve refs: their
 * "branch" is a commit SHA, which can never support a pattern and blocks the
 * inference window from converging. One-off, run by hand.
 */
export const pruneShaSamples = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("deploymentSamples").collect();
    const junk = all.filter((s) => /^[0-9a-f]{40}$/.test(s.branch));
    for (const sample of junk) await ctx.db.delete(sample._id);
    return { deleted: junk.length, kept: all.length - junk.length };
  },
});

/**
 * The deploy log, newest first: what shipped, when, from which branch.
 *
 * Rendered in the History popover, so it degrades (empty for no access)
 * rather than refusing; a query is rendered, a mutation is invoked.
 */
export const deployHistory = query({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, ...viewer }) => {
    const viewerId = await resolveViewer(ctx, viewer);
    const project = viewerId ? await accessibleProject(ctx, projectId, viewerId) : null;
    if (!project) return [];
    const rows = await ctx.db
      .query("deploys")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows
      .sort((a, b) => b.at - a.at)
      .slice(0, 30)
      .map((d) => ({
        _id: d._id,
        at: d.at,
        production: d.production,
        branch: d.branch,
        sha: d.sha ? d.sha.slice(0, 7) : null,
        url: d.url,
        current: d.url === project.previewUrl,
      }));
  },
});

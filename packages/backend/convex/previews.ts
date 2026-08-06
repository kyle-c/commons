import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { accessibleProject, randomToken, resolveViewer } from "./access";
import { normalizeRemote } from "./previewLogic";
import { siteUrl } from "./siteUrl";

/**
 * Commons-hosted previews: the link the system mints when nobody has Vercel.
 *
 * The build runs in the customer's own CI (the same commons-agent workflow
 * that runs agents and crawls, payload mode "preview"), the static output
 * uploads back here token-authenticated (the crawl-ingest pattern), and the
 * files serve from storage exactly the way the web app itself is served.
 * Commons never builds customer code on Commons infrastructure — the
 * customer's Actions minutes build it under their own credentials, which is
 * the same trust line every other CI feature draws.
 *
 * Static only, said honestly: Vite, Expo web, and export-configured Next
 * build to files; an app needing SSR or API routes reports why instead of
 * pretending. previewSource "commons" obeys the house rule — a human's
 * pasted URL is never overwritten.
 */

const MAX_FILES = 200;

export const startBuild = mutation({
  args: {
    projectId: v.id("projects"),
    ref: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = viewerId ? await accessibleProject(ctx, args.projectId, viewerId) : null;
    if (!project) return { ok: false as const, reason: "no_access" as const };
    if (!project.gitRemote) return { ok: false as const, reason: "no_repo" as const };

    const ref = args.ref ?? "";
    const existing = await ctx.db
      .query("previewBuilds")
      .withIndex("by_project_ref", (q) => q.eq("projectId", args.projectId).eq("ref", ref))
      .collect();
    if (existing.some((b) => b.status === "building" && Date.now() - b._creationTime < 20 * 60 * 1000)) {
      return { ok: false as const, reason: "already_building" as const };
    }

    if (!project.previewToken) {
      await ctx.db.patch(args.projectId, { previewToken: randomToken(20) });
    }
    const runToken = randomToken(24);
    const buildId = await ctx.db.insert("previewBuilds", {
      projectId: args.projectId,
      ref,
      status: "building",
      runToken,
      files: [],
    });
    await ctx.scheduler.runAfter(0, internal.previews.dispatchBuild, {
      buildId,
      projectId: args.projectId,
      gitRemote: project.gitRemote,
      ref,
      runToken,
    });
    return { ok: true as const, buildId };
  },
});

export const dispatchBuild = internalAction({
  args: {
    buildId: v.id("previewBuilds"),
    projectId: v.id("projects"),
    gitRemote: v.string(),
    ref: v.string(),
    runToken: v.string(),
  },
  handler: async (ctx, args) => {
    const fullName = normalizeRemote(args.gitRemote).match(/github\.com\/([^/]+\/[^/]+)$/)?.[1];
    if (!fullName) {
      return void (await ctx.runMutation(internal.previews.markError, {
        buildId: args.buildId,
        runToken: args.runToken,
        error: "Not a GitHub repository.",
      }));
    }
    const installationId = await ctx.runQuery(internal.cloudAgents.installationForProject, {
      projectId: args.projectId,
      fullName,
    });
    if (!installationId) {
      return void (await ctx.runMutation(internal.previews.markError, {
        buildId: args.buildId,
        runToken: args.runToken,
        error: "No GitHub installation covers this repository — connect GitHub first.",
      }));
    }
    const { installationToken } = await import("./githubApp");
    try {
      const token = await installationToken(installationId);
      // Preflight: repository_dispatch returns 204 whether or not any
      // workflow listens — a repo without commons-agent.yml swallows the
      // event and the build waits forever on a run that never starts. Ask
      // for the file first and refuse in plain words instead.
      const wf = await fetch(
        `https://api.github.com/repos/${fullName}/contents/.github/workflows/commons-agent.yml`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
      );
      if (wf.status === 404) {
        return void (await ctx.runMutation(internal.previews.markError, {
          buildId: args.buildId,
          runToken: args.runToken,
          error: "This repo doesn't have the Commons workflow yet — add it from the agent setup step, then try again.",
        }));
      }
      const response = await fetch(`https://api.github.com/repos/${fullName}/dispatches`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "commons-agent",
          client_payload: {
            mode: "preview",
            buildId: args.buildId,
            runToken: args.runToken,
            ref: args.ref,
            callback: siteUrl(),
          },
        }),
      });
      if (response.status !== 204) {
        await ctx.runMutation(internal.previews.markError, {
          buildId: args.buildId,
          runToken: args.runToken,
          error: `GitHub refused the dispatch (${response.status}) — is the commons-agent workflow on the default branch?`,
        });
      }
    } catch (error) {
      await ctx.runMutation(internal.previews.markError, {
        buildId: args.buildId,
        runToken: args.runToken,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

/** Token gate for the upload endpoints; malformed ids refuse, never throw. */
export const buildTokenOk = internalQuery({
  args: { buildId: v.string(), runToken: v.string() },
  handler: async (ctx, { buildId, runToken }) => {
    const id = ctx.db.normalizeId("previewBuilds", buildId);
    if (!id) return null;
    const build = await ctx.db.get(id);
    if (!build || build.runToken !== runToken) return null;
    if (build.status !== "building") return null;
    if (build.files.length >= MAX_FILES) return null;
    return { id, projectId: build.projectId };
  },
});

export const appendFile = internalMutation({
  args: { buildId: v.id("previewBuilds"), path: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { buildId, path, storageId }) => {
    const build = await ctx.db.get(buildId);
    if (!build || build.status !== "building" || build.files.length >= MAX_FILES) {
      await ctx.storage.delete(storageId).catch(() => {});
      return { ok: false };
    }
    await ctx.db.patch(buildId, { files: [...build.files, { path, storageId }] });
    return { ok: true };
  },
});

export const finishBuild = internalMutation({
  args: {
    buildId: v.id("previewBuilds"),
    runToken: v.string(),
    indexHtml: v.optional(v.string()),
    defaultRef: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const build = await ctx.db.get(args.buildId);
    if (!build || build.runToken !== args.runToken || build.status !== "building") return;
    if (args.error || !args.indexHtml) {
      await ctx.db.patch(args.buildId, { status: "error", error: args.error ?? "The build produced no index.html." });
      return;
    }
    await ctx.db.patch(args.buildId, { status: "ready", indexHtml: args.indexHtml });

    // Supersede: older builds of the same ref free their storage now.
    const siblings = await ctx.db
      .query("previewBuilds")
      .withIndex("by_project_ref", (q) => q.eq("projectId", build.projectId).eq("ref", build.ref))
      .collect();
    for (const old of siblings) {
      if (old._id === args.buildId) continue;
      for (const file of old.files) await ctx.storage.delete(file.storageId).catch(() => {});
      await ctx.db.delete(old._id);
    }

    // The link writes itself — for the default ref, when no human set one.
    const project = await ctx.db.get(build.projectId);
    if (!project) return;
    const url = `${siteUrl()}/preview/${project.previewToken}/${encodeURIComponent(build.ref || "main")}/`;
    if (args.defaultRef && (!project.previewUrl || project.previewSource === "commons")) {
      await ctx.db.patch(build.projectId, {
        previewUrl: url.replace(/\/$/, ""),
        previewSource: "commons",
        lastDeployAt: Date.now(),
        snapshotsStaleAt: Date.now(),
      });
    }
  },
});

export const markError = internalMutation({
  args: { buildId: v.id("previewBuilds"), runToken: v.string(), error: v.string() },
  handler: async (ctx, { buildId, runToken, error }) => {
    const build = await ctx.db.get(buildId);
    if (!build || build.runToken !== runToken) return;
    if (build.status === "building") await ctx.db.patch(buildId, { status: "error", error });
  },
});

/** The serving lookup: project by preview token, newest ready build for ref. */
export const buildForServing = internalQuery({
  args: { previewToken: v.string(), ref: v.string() },
  handler: async (ctx, { previewToken, ref }) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_preview_token", (q) => q.eq("previewToken", previewToken))
      .unique();
    if (!project || project.archivedAt) return null;
    const builds = await ctx.db
      .query("previewBuilds")
      .withIndex("by_project_ref", (q) => q.eq("projectId", project._id).eq("ref", ref))
      .collect();
    const ready = builds.filter((b) => b.status === "ready");
    if (ready.length === 0) return null;
    return ready.reduce((a, b) => (b._creationTime > a._creationTime ? b : a));
  },
});

/** Build status for the popover — a query, so the popover tracks the build live. */
export const status = query({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = viewerId ? await accessibleProject(ctx, args.projectId, viewerId) : null;
    if (!project) return null;
    const builds = await ctx.db
      .query("previewBuilds")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const newest = builds.sort((a, b) => b._creationTime - a._creationTime)[0];
    return newest ? { status: newest.status, ref: newest.ref, error: newest.error ?? null } : null;
  },
});

/**
 * The catch-all the preflight can't cover: a workflow that started and died
 * without reporting (crashed runner, cancelled run, network). Building
 * beyond 25 minutes is a corpse — the workflow itself times out at 30 —
 * and a row stuck "building" pins the popover to a lie forever.
 */
export const sweepStalled = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 25 * 60 * 1000;
    const builds = await ctx.db.query("previewBuilds").collect();
    for (const build of builds) {
      if (build.status !== "building" || build._creationTime > cutoff) continue;
      await ctx.db.patch(build._id, {
        status: "error",
        error: "The build never reported back — its Actions run may have failed. Check the repo's Actions tab, or try again.",
      });
    }
  },
});

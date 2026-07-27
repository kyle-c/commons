import { mutation, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { accessibleProject, canAccessProject, resolveViewer } from "./access";
import { isMember, ensurePersonalWorkspace } from "./workspaces";

export const create = mutation({
  args: {
    name: v.string(),
    createdBy: v.id("users"),
    // Destination workspace; legacy clients omit it → creator's playground.
    workspaceId: v.optional(v.id("workspaces")),
    visibility: v.optional(v.union(v.literal("team"), v.literal("private"))),
    repoPath: v.optional(v.string()),
    gitRemote: v.optional(v.string()),
    framework: v.optional(v.string()),
    brandColors: v.optional(v.array(v.string())),
    figmaFileKey: v.optional(v.string()),
    frames: v.array(
      v.object({
        kind: v.union(v.literal("route"), v.literal("figma")),
        title: v.string(),
        section: v.optional(v.string()),
        routePath: v.optional(v.string()),
        figmaNodeId: v.optional(v.string()),
        x: v.number(),
        y: v.number(),
        width: v.number(),
        height: v.number(),
      })
    ),
  },
  handler: async (ctx, { frames, ...project }) => {
    // Every project lands in a workspace: the requested one (creator must be
    // a member) or, for legacy clients that don't send one, the playground.
    let workspaceId = project.workspaceId;
    if (workspaceId) {
      if (!(await isMember(ctx, workspaceId, project.createdBy))) throw new Error("Not in that workspace");
    } else {
      const creator = await ctx.db.get(project.createdBy);
      if (!creator) throw new Error("Unknown user");
      workspaceId = await ensurePersonalWorkspace(ctx, creator);
    }
    const projectId = await ctx.db.insert("projects", { ...project, workspaceId });
    for (const frame of frames) {
      await ctx.db.insert("frames", { projectId, ...frame });
    }
    return projectId;
  },
});

export const get = query({
  args: { projectId: v.id("projects"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => accessibleProject(ctx, args.projectId, await resolveViewer(ctx, args)),
});

// Home view: every project this user can see (archived included, flagged by
// archivedAt — the client tucks those behind a per-workspace toggle), with
// creator, presence, the viewer's pins, and the "needs you" signal.
export const listWithActivity = query({
  args: { userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    const projects = await ctx.db.query("projects").collect();
    const visible = await Promise.all(projects.map((p) => canAccessProject(ctx, p, userId)));
    const active = projects.filter((_, i) => visible[i]);
    const workspaceNames = new Map<string, string>();
    for (const p of active) {
      if (p.workspaceId && !workspaceNames.has(p.workspaceId)) {
        workspaceNames.set(p.workspaceId, (await ctx.db.get(p.workspaceId))?.name ?? "");
      }
    }
    const pins = userId
      ? await ctx.db
          .query("projectPins")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect()
      : [];
    const pinned = new Set(pins.map((p) => p.projectId as string));
    return await Promise.all(
      active.map(async (project) => {
        const creator = await ctx.db.get(project.createdBy);
        // Live avatars come from presence.activeByProject — a separate
        // subscription, so heartbeat churn never re-runs this query.
        // Bounded reads: the home needs counts and recency, not full
        // histories. (A dead `thumbnail` payload used to force full thread +
        // frame collects here on every invalidation — removed.)
        const frames = await ctx.db
          .query("frames")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .take(201);
        const threads = await ctx.db
          .query("threads")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .order("desc")
          .take(201);
        const newestSession = await ctx.db
          .query("agentSessions")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .order("desc")
          .first();
        // "Where is the action": the newest thread/agent session beats the
        // creation date for ordering and the card's "active … ago" label.
        const lastActivityAt = Math.max(
          project._creationTime,
          threads[0]?._creationTime ?? 0,
          newestSession?._creationTime ?? 0
        );
        // "Needs you": threads someone else opened after your previous visit
        // ended. Only fires on projects you've actually been to — the strip
        // is a return prompt, not a discovery feed.
        const visit = userId
          ? await ctx.db
              .query("presence")
              .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", project._id))
              .unique()
          : null;
        const since = visit?.previousVisitAt;
        const newThreadsSinceVisit = since
          ? threads.filter((t) => t._creationTime > since && t.createdBy !== userId).length
          : 0;
        return {
          ...project,
          coverUrl: project.coverImageId ? await ctx.storage.getUrl(project.coverImageId) : null,
          workspaceName: project.workspaceId ? workspaceNames.get(project.workspaceId) : undefined,
          lastActivityAt,
          creator,
          frameCount: frames.length,
          openThreadCount: threads.filter((t) => !t.resolvedAt).length,
          pinned: pinned.has(project._id),
          newThreadsSinceVisit,
        };
      })
    );
  },
});

export const frames = query({
  args: { projectId: v.id("projects"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await accessibleProject(ctx, args.projectId, await resolveViewer(ctx, args)))) return [];
    const rows = await ctx.db
      .query("frames")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    // Latest snapshot per frame (SNAP-3): placeholder fallback + capture staleness.
    return await Promise.all(
      rows.map(async (frame) => {
        const snapshot = await ctx.db
          .query("frameSnapshots")
          .withIndex("by_frame", (q) => q.eq("frameId", frame._id))
          .unique();
        return {
          ...frame,
          snapshotUrl: snapshot ? await ctx.storage.getUrl(snapshot.storageId) : null,
          snapshotAt: snapshot?.capturedAt ?? null,
        };
      })
    );
  },
});

// SNAP-3: a host with a live dev server keeps one fresh snapshot per frame.
export const saveFrameSnapshot = mutation({
  args: {
    frameId: v.id("frames"),
    storageId: v.id("_storage"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const frame = await ctx.db.get(args.frameId);
    if (!frame) throw new Error("Frame not found");
    if (!(await accessibleProject(ctx, frame.projectId, await resolveViewer(ctx, args)))) {
      throw new Error("Not allowed");
    }
    const existing = await ctx.db
      .query("frameSnapshots")
      .withIndex("by_frame", (q) => q.eq("frameId", args.frameId))
      .unique();
    if (existing) {
      await ctx.storage.delete(existing.storageId).catch(() => {});
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert("frameSnapshots", {
      frameId: args.frameId,
      projectId: frame.projectId,
      storageId: args.storageId,
      capturedAt: Date.now(),
    });
  },
});

// Web share link: mint/revoke the read-only /p/<token> page (creator-only).
export const setShareToken = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
    enable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) throw new Error("Only the project creator can share to web");
    const shareToken = args.enable
      ? (project.shareToken ?? Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join(""))
      : undefined;
    await ctx.db.patch(args.projectId, { shareToken });
    return shareToken ?? null;
  },
});

/**
 * "Since you were last here" (#4): counts of what happened in this project
 * after the viewer's previous visit ended. Null when there's no prior visit
 * or nothing new — the strip only appears when there's something to say.
 */
export const catchUp = query({
  args: { projectId: v.id("projects"), userId: v.id("users"), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    if (!userId || !(await accessibleProject(ctx, args.projectId, userId))) return null;
    const row = await ctx.db
      .query("presence")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", args.projectId))
      .unique();
    const since = row?.previousVisitAt;
    if (!since) return null;

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    let newThreads = 0;
    let newReplies = 0;
    for (const thread of threads) {
      const isNewThread = thread._creationTime > since && thread.createdBy !== userId;
      if (isNewThread) newThreads++;
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .collect();
      newReplies += messages.filter(
        (m) => m._creationTime > since && m.authorId !== userId && !(isNewThread && m._creationTime === messages[0]?._creationTime)
      ).length;
    }
    const sessions = await ctx.db
      .query("agentSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const newAgentSessions = sessions.filter((s) => s._creationTime > since && s.hostUserId !== userId).length;

    const tests = await ctx.db
      .query("tests")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    let newTestSessions = 0;
    for (const test of tests) {
      const testSessions = await ctx.db
        .query("testSessions")
        .withIndex("by_test", (q) => q.eq("testId", test._id))
        .collect();
      newTestSessions += testSessions.filter((s) => (s.completedAt ?? 0) > since).length;
    }

    if (newThreads + newReplies + newAgentSessions + newTestSessions === 0) return null;
    return { since, newThreads, newReplies, newAgentSessions, newTestSessions };
  },
});

/** Everything the read-only web share page needs, keyed by its token. */
export const sharePageData = internalQuery({
  args: { shareToken: v.string() },
  handler: async (ctx, { shareToken }) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_share_token", (q) => q.eq("shareToken", shareToken))
      .unique();
    if (!project || project.archivedAt) return null;
    const frames = await ctx.db
      .query("frames")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const framesWithSnapshots = await Promise.all(
      frames.map(async (frame) => {
        const snapshot = await ctx.db
          .query("frameSnapshots")
          .withIndex("by_frame", (q) => q.eq("frameId", frame._id))
          .unique();
        return { ...frame, snapshotUrl: snapshot ? await ctx.storage.getUrl(snapshot.storageId) : null };
      })
    );
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const threadsWithMessages = await Promise.all(
      threads.map(async (thread) => {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .collect();
        return {
          ...thread,
          messages: await Promise.all(
            messages.map(async (m) => {
              const author = m.authorId ? await ctx.db.get(m.authorId) : null;
              return {
                body: m.body,
                at: m._creationTime,
                authorName: author?.name ?? (m.guestName ? `${m.guestName} (guest)` : "Teammate"),
                avatarColor: author?.avatarColor ?? "#9d9da6",
              };
            })
          ),
        };
      })
    );
    // NAR-2: approved design rationale travels with the share page.
    const approvedAnnotations = await ctx.db
      .query("annotations")
      .withIndex("by_project_status", (q) => q.eq("projectId", project._id).eq("status", "approved"))
      .take(500);
    const annotations = approvedAnnotations
      .sort((a, b) => a.order - b.order)
      .map((a) => ({
        frameId: a.frameId ?? null,
        flowTitle: a.flowTitle ?? null,
        text: a.text,
        inferred: a.citations.length === 0,
      }));
    return {
      name: project.name,
      projectId: project._id,
      frames: framesWithSnapshots,
      threads: threadsWithMessages,
      annotations,
    };
  },
});

// Creator-only controls for private projects.
export const setVisibility = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    visibility: v.union(v.literal("team"), v.literal("private")),
  },
  handler: async (ctx, { projectId, userId, visibility }) => {
    const project = await ctx.db.get(projectId);
    if (!project || project.createdBy !== userId) throw new Error("Only the project's creator can change visibility.");
    await ctx.db.patch(projectId, { visibility });
  },
});

export const setMembers = mutation({
  args: { projectId: v.id("projects"), userId: v.id("users"), memberIds: v.array(v.id("users")) },
  handler: async (ctx, { projectId, userId, memberIds }) => {
    const project = await ctx.db.get(projectId);
    if (!project || project.createdBy !== userId) throw new Error("Only the project's creator can manage members.");
    await ctx.db.patch(projectId, { memberIds: memberIds.filter((id) => id !== project.createdBy) });
  },
});

export const moveFrame = mutation({
  args: {
    frameId: v.id("frames"),
    x: v.number(),
    y: v.number(),
  },
  handler: async (ctx, { frameId, x, y }) => {
    await ctx.db.patch(frameId, { x, y });
  },
});

export const archive = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { archivedAt: Date.now() });
  },
});

// Archive/restore from the home card. Any workspace member — same trust
// level as rename. Archiving hides the card (share links stay alive);
// restoring puts it back in the grid.
export const setArchived = mutation({
  args: {
    projectId: v.id("projects"),
    archived: v.boolean(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = await accessibleProject(ctx, args.projectId, viewerId);
    if (!project) throw new Error("You don't have access to this project.");
    await ctx.db.patch(args.projectId, { archivedAt: args.archived ? Date.now() : undefined });
  },
});

// Shared lifecycle label on the card. Any member; undefined clears it.
export const setStatus = mutation({
  args: {
    projectId: v.id("projects"),
    status: v.optional(
      v.union(
        v.literal("exploring"),
        v.literal("in-review"),
        v.literal("testing"),
        v.literal("shipped"),
        v.literal("parked")
      )
    ),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = await accessibleProject(ctx, args.projectId, viewerId);
    if (!project) throw new Error("You don't have access to this project.");
    await ctx.db.patch(args.projectId, { status: args.status });
  },
});

// Personal pin: sorts the project first in its section on this user's home.
export const togglePin = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    if (!viewerId) throw new Error("Sign in to pin projects.");
    if (!(await accessibleProject(ctx, args.projectId, viewerId))) {
      throw new Error("You don't have access to this project.");
    }
    const existing = await ctx.db
      .query("projectPins")
      .withIndex("by_user_project", (q) => q.eq("userId", viewerId).eq("projectId", args.projectId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    else await ctx.db.insert("projectPins", { userId: viewerId, projectId: args.projectId });
    return !existing;
  },
});

// DEPRECATED: machine-local paths live in repoLinks now. Kept for old callers.
export const setRepoPath = mutation({
  args: { projectId: v.id("projects"), repoPath: v.string() },
  handler: async (ctx, { projectId, repoPath }) => {
    await ctx.db.patch(projectId, { repoPath });
  },
});

// Re-run of route discovery against a linked working copy — fills in frames
// for projects that were created before their framework was supported.
export const rediscover = mutation({
  args: {
    projectId: v.id("projects"),
    framework: v.optional(v.string()),
    frames: v.array(
      v.object({
        kind: v.union(v.literal("route"), v.literal("figma")),
        title: v.string(),
        section: v.optional(v.string()),
        routePath: v.optional(v.string()),
        figmaNodeId: v.optional(v.string()),
        x: v.number(),
        y: v.number(),
        width: v.number(),
        height: v.number(),
      })
    ),
    // "Tidy": also move/resize known frames into the derived section layout.
    relayout: v.optional(v.boolean()),
    brandColors: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { projectId, framework, frames, relayout, brandColors }) => {
    if (framework) await ctx.db.patch(projectId, { framework });
    if (brandColors) await ctx.db.patch(projectId, { brandColors });
    const existing = await ctx.db
      .query("frames")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const knownByRoute = new Map(existing.filter((f) => f.routePath).map((f) => [f.routePath, f]));
    for (const frame of frames) {
      const known = frame.routePath ? knownByRoute.get(frame.routePath) : undefined;
      if (known) {
        if (relayout) {
          await ctx.db.patch(known._id, {
            section: frame.section,
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
          });
        } else if (frame.section && known.section !== frame.section) {
          // Keep the user's positions; adopt newly derived section labels.
          await ctx.db.patch(known._id, { section: frame.section });
        }
        continue;
      }
      await ctx.db.insert("frames", { projectId, ...frame });
    }
  },
});

// Custom card cover from the home card's hover affordance. Any member;
// replacing deletes the old file.
export const setCover = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = await accessibleProject(ctx, args.projectId, viewerId);
    if (!project) throw new Error("You don't have access to this project.");
    if (project.coverImageId) await ctx.storage.delete(project.coverImageId).catch(() => {});
    await ctx.db.patch(args.projectId, { coverImageId: args.storageId });
  },
});

// Rename from the home card's hover affordance. Any workspace member can
// rename — same trust level as moving frames on the shared canvas.
export const rename = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = await accessibleProject(ctx, args.projectId, viewerId);
    if (!project) throw new Error("You don't have access to this project.");
    const name = args.name.trim().slice(0, 60);
    if (!name) throw new Error("A project needs a name.");
    await ctx.db.patch(args.projectId, { name });
  },
});

// Canonical identity of the project's code source (e.g. the origin URL).
export const setGitRemote = mutation({
  args: { projectId: v.id("projects"), gitRemote: v.string() },
  handler: async (ctx, { projectId, gitRemote }) => {
    await ctx.db.patch(projectId, { gitRemote });
  },
});

// Deployed preview base URL; frames render previewUrl + routePath for
// teammates without a local working copy. hasBranchPattern distinguishes
// "clear the pattern" from "old client that never sends it" (version skew).
export const setPreviewUrl = mutation({
  args: {
    projectId: v.id("projects"),
    previewUrl: v.optional(v.string()),
    branchPreviewPattern: v.optional(v.string()),
    hasBranchPattern: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectId, previewUrl, branchPreviewPattern, hasBranchPattern }) => {
    await ctx.db.patch(projectId, {
      previewUrl,
      ...(hasBranchPattern ? { branchPreviewPattern: branchPreviewPattern || undefined } : {}),
    });
  },
});

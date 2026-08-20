import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  accessibleProject,
  canAccessProject,
  requireProjectAccess,
  requireViewer,
  resolveViewer, randomToken } from "./access";
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
  // repoPath is accepted (old clients still send it) but never written:
  // machine-local paths live in repoLinks, one per (user, machine). Writing a
  // single shared path onto the project was the pre-repoLinks model and every
  // reader of it is gone.
  handler: async (ctx, { frames, repoPath: _legacy, ...project }) => {
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
        // Live avatars come from presence.activeByProject, a separate
        // subscription, so heartbeat churn never re-runs this query. The
        // activeUsers COMPAT field that used to re-couple it here (for
        // ≤0.2.37 renderers) is gone — every shipped client reads the
        // dedicated subscription now, so the isolation is finally real.
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

/**
 * Phase 2: a deploy landed, so every snapshot now predates the running app.
 * The webhook can't take pictures — it has no browser — so the work falls to
 * whichever desktop client has the project open.
 *
 * Every open client sees the same staleness flag at the same moment, so this
 * hands out the job exactly once: the mutation is a transaction, so only the
 * first caller sees a non-null snapshotsStaleAt and clears it. Everyone else
 * gets false and does nothing.
 *
 * If the winner then quits mid-capture, the snapshots simply stay old until
 * the next deploy. That's the deliberate trade: a stale picture is a smaller
 * harm than every open client capturing the same routes at once.
 */
export const claimSnapshotRefresh = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await accessibleProject(ctx, args.projectId, await resolveViewer(ctx, args));
    if (!project?.snapshotsStaleAt || !project.previewUrl) return { claimed: false as const };
    await ctx.db.patch(project._id, { snapshotsStaleAt: undefined });
    return { claimed: true as const, previewUrl: project.previewUrl };
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
      ? (project.shareToken ?? randomToken(16))
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
/**
 * The same project data, for the real web app running in guest mode.
 *
 * Phase 3 replaces the hand-written share template with the actual canvas,
 * scoped by the share token instead of a session. The token *is* the
 * credential here: holding it is the whole authorisation story, which is why
 * revoking it in Sharing cuts access instantly.
 *
 * Returns whole message docs (not a flattened view), so the guest canvas and
 * keeps ids, so a guest can reply to a thread rather than only read it.
 */
export const sharePage = query({
  args: { shareToken: v.string() },
  handler: async (ctx, { shareToken }) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_share_token", (q) => q.eq("shareToken", shareToken))
      .unique();
    // Degrades rather than throwing: a revoked link should render an
    // explanation, not an error boundary.
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
        return {
          ...frame,
          snapshotUrl: snapshot ? await ctx.storage.getUrl(snapshot.storageId) : null,
          snapshotAt: snapshot?.capturedAt ?? null,
        };
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
                ...m,
                author: author
                  ? { _id: author._id, name: author.name, avatarColor: author.avatarColor, avatarUrl: author.avatarUrl }
                  : null,
              };
            })
          ),
        };
      })
    );

    // Approved narration only: drafts are internal review state and a guest
    // must never see them.
    const annotations = (
      await ctx.db
        .query("annotations")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .take(500)
    ).filter((a) => a.status === "approved");

    return {
      project: {
        _id: project._id,
        name: project.name,
        previewUrl: project.previewUrl,
        status: project.status,
        // So the guest page can offer "a newer version deployed, reload".
        lastDeployAt: project.lastDeployAt,
      },
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
    sessionToken: v.optional(v.string()),
    visibility: v.union(v.literal("team"), v.literal("private")),
  },
  handler: async (ctx, { projectId, visibility, ...viewer }) => {
    // The creator check is only as good as the identity behind it, so the
    // identity comes from the session, never from the userId argument.
    const userId = await requireViewer(ctx, viewer);
    const project = await ctx.db.get(projectId);
    if (!project || project.createdBy !== userId) throw new Error("Only the project's creator can change visibility.");
    await ctx.db.patch(projectId, { visibility });
  },
});

export const setMembers = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
    memberIds: v.array(v.id("users")),
  },
  handler: async (ctx, { projectId, memberIds, ...viewer }) => {
    const userId = await requireViewer(ctx, viewer);
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
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { frameId, x, y, ...viewer }) => {
    const frame = await ctx.db.get(frameId);
    if (!frame) throw new Error("Frame not found");
    await requireProjectAccess(ctx, frame.projectId, viewer);
    await ctx.db.patch(frameId, { x, y });
  },
});

/**
 * Option-drag on the canvas: a fresh, independent copy of a frame at the drop
 * point. It clones what the frame *is* (route, kind, size) but nothing it has
 * *collected* — comments, reactions, votes, and agent work land on the new
 * _id, so the original is untouched. Not a variant: variant lineage is left
 * off deliberately.
 */
export const duplicateFrame = mutation({
  args: {
    frameId: v.id("frames"),
    x: v.number(),
    y: v.number(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { frameId, x, y, ...viewer }) => {
    const original = await ctx.db.get(frameId);
    if (!original) throw new Error("That screen is gone.");
    await requireProjectAccess(ctx, original.projectId, viewer);
    return await ctx.db.insert("frames", {
      projectId: original.projectId,
      kind: original.kind,
      title: original.title,
      section: original.section,
      routePath: original.routePath,
      figmaNodeId: original.figmaNodeId,
      stateLabel: original.stateLabel,
      stateOrigin: original.stateOrigin,
      copyOf: original._id,
      x,
      y,
      width: original.width,
      height: original.height,
    });
  },
});

/**
 * Remove a hand-made duplicate and everything that accreted on it. Scoped to
 * copies (copyOf set) on purpose: the canonical route/state frames are the
 * app's own map and come back on the next sync — this is not the door for
 * deleting those. Sweeps every table that points at the frame so a removed
 * copy leaves no orphans.
 */
export const deleteFrame = mutation({
  args: {
    frameId: v.id("frames"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { frameId, ...viewer }) => {
    const frame = await ctx.db.get(frameId);
    if (!frame) return;
    await requireProjectAccess(ctx, frame.projectId, viewer);
    if (!frame.copyOf) throw new Error("Only duplicated frames can be removed here.");

    const threads = await ctx.db.query("threads").withIndex("by_frame", (q) => q.eq("frameId", frameId)).collect();
    for (const thread of threads) {
      const messages = await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect();
      for (const m of messages) await ctx.db.delete(m._id);
      await ctx.db.delete(thread._id);
    }
    const reactions = await ctx.db.query("reactions").withIndex("by_frame_user", (q) => q.eq("frameId", frameId)).collect();
    for (const r of reactions) await ctx.db.delete(r._id);
    const gifs = await ctx.db.query("gifReactions").withIndex("by_frame", (q) => q.eq("frameId", frameId)).collect();
    for (const g of gifs) await ctx.db.delete(g._id);
    const votes = await ctx.db.query("frameVotes").withIndex("by_frame_user", (q) => q.eq("frameId", frameId)).collect();
    for (const vt of votes) await ctx.db.delete(vt._id);
    const snaps = await ctx.db.query("frameSnapshots").withIndex("by_frame", (q) => q.eq("frameId", frameId)).collect();
    for (const s of snaps) await ctx.db.delete(s._id);
    // annotations have no by_frame index — scan the project's and match.
    const notes = await ctx.db.query("annotations").withIndex("by_project", (q) => q.eq("projectId", frame.projectId)).collect();
    for (const n of notes) if (n.frameId === frameId) await ctx.db.delete(n._id);
    // Agent sessions keep their history; just detach so nothing points at a
    // frame that's gone.
    const sessions = await ctx.db.query("agentSessions").withIndex("by_project", (q) => q.eq("projectId", frame.projectId)).collect();
    for (const s of sessions) if (s.frameId === frameId) await ctx.db.patch(s._id, { frameId: undefined });

    await ctx.db.delete(frameId);
  },
});

export const archive = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, ...viewer }) => {
    await requireProjectAccess(ctx, projectId, viewer);
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

/**
 * Permanently delete an archived project and everything under it.
 *
 * Archive-first is a deliberate two-step: archiving is reversible and is where
 * a project rests; deletion is not, so it is only offered from the archived
 * shelf, never from the live grid. A project you can still see is a project
 * you can still restore.
 *
 * The project row and its cover image go now, so the card vanishes at once and
 * every viewer-facing query (which resolves through the project) immediately
 * returns nothing for it. The children — frames, threads, messages,
 * transcripts, test sessions, snapshots and their storage blobs — are swept by
 * a batched cascade, because a busy project's transcript alone can exceed one
 * transaction's limits. The cascade re-queries live state each run and deletes
 * strictly leaves-first, so it converges no matter how large the project.
 */
export const deleteArchived = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = await accessibleProject(ctx, args.projectId, viewerId);
    if (!project) throw new Error("You don't have access to this project.");
    if (!project.archivedAt) {
      throw new Error("Archive the project before deleting it — deletion is only offered from the archive.");
    }
    if (project.coverImageId) await ctx.storage.delete(project.coverImageId).catch(() => {});
    await ctx.db.delete(args.projectId);
    await ctx.scheduler.runAfter(0, internal.projects.cascadeDeleteProject, { projectId: args.projectId });
    return { ok: true };
  },
});

/**
 * Delete up to a budget of a deleted project's descendants, then reschedule
 * until none remain. Order is leaves-first so parents can still enumerate
 * their children: messages before threads, events before their sessions.
 */
export const cascadeDeleteProject = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const BUDGET = 400;
    let spent = 0;
    const exhausted = () => spent >= BUDGET;

    // 1. Threads → their messages (with image blobs) and notifications.
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const thread of threads) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .take(BUDGET - spent);
      for (const message of messages) {
        for (const blob of message.images ?? []) await ctx.storage.delete(blob).catch(() => {});
        await ctx.db.delete(message._id);
        spent += 1;
      }
      if (exhausted()) return void (await reschedule(ctx, projectId));
      const notes = await ctx.db
        .query("notifications")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .take(BUDGET - spent);
      for (const note of notes) {
        await ctx.db.delete(note._id);
        spent += 1;
      }
      if (exhausted()) return void (await reschedule(ctx, projectId));
      // The thread itself only once its messages are gone (next pass will if
      // this thread still had a full budget of messages above).
      const remaining = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .first();
      if (!remaining) {
        await ctx.db.delete(thread._id);
        spent += 1;
        if (exhausted()) return void (await reschedule(ctx, projectId));
      }
    }

    // 2. Agent sessions → their events.
    const sessions = await ctx.db
      .query("agentSessions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const session of sessions) {
      const events = await ctx.db
        .query("agentEvents")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .take(BUDGET - spent);
      for (const event of events) {
        await ctx.db.delete(event._id);
        spent += 1;
      }
      if (exhausted()) return void (await reschedule(ctx, projectId));
      const more = await ctx.db
        .query("agentEvents")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .first();
      if (!more) {
        await ctx.db.delete(session._id);
        spent += 1;
        if (exhausted()) return void (await reschedule(ctx, projectId));
      }
    }

    // 3. Tests → their sessions and events.
    const tests = await ctx.db
      .query("tests")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const test of tests) {
      const testChildQueries = [
        () => ctx.db.query("testSessions").withIndex("by_test", (q) => q.eq("testId", test._id)),
        () => ctx.db.query("testEvents").withIndex("by_test", (q) => q.eq("testId", test._id)),
      ];
      for (const build of testChildQueries) {
        const rows = await build().take(BUDGET - spent);
        for (const row of rows) {
          await ctx.db.delete(row._id);
          spent += 1;
        }
        if (exhausted()) return void (await reschedule(ctx, projectId));
      }
      const leftover =
        (await ctx.db.query("testSessions").withIndex("by_test", (q) => q.eq("testId", test._id)).first()) ??
        (await ctx.db.query("testEvents").withIndex("by_test", (q) => q.eq("testId", test._id)).first());
      if (!leftover) {
        await ctx.db.delete(test._id);
        spent += 1;
        if (exhausted()) return void (await reschedule(ctx, projectId));
      }
    }

    // 4. Frame snapshots (with blobs), then everything keyed directly on the
    //    project. Each is take(budget) with a reschedule so a huge table
    //    cannot blow the transaction.
    const snaps = await ctx.db
      .query("frameSnapshots")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(BUDGET - spent);
    for (const snap of snaps) {
      await ctx.storage.delete(snap.storageId).catch(() => {});
      await ctx.db.delete(snap._id);
      spent += 1;
    }
    if (exhausted()) return void (await reschedule(ctx, projectId));

    // Crawl proposals hold screenshot blobs — delete the blob with the row, or
    // deleting a project leaks every state screenshot its crawls ever took.
    const staleProposals = await ctx.db
      .query("flowStateProposals")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(BUDGET - spent);
    for (const proposal of staleProposals) {
      // An approved proposal handed its blob to a frameSnapshot, which the
      // snapshot sweep above already deleted; deleting again would throw.
      if (proposal.status === "pending") await ctx.storage.delete(proposal.storageId).catch(() => {});
      await ctx.db.delete(proposal._id);
      spent += 1;
    }
    if (exhausted()) return void (await reschedule(ctx, projectId));

    // Preview builds own a manifest of storage blobs each; blob-first.
    const buildRows = await ctx.db
      .query("previewBuilds")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(Math.max(1, Math.floor((BUDGET - spent) / 8)));
    for (const build of buildRows) {
      for (const file of build.files) await ctx.storage.delete(file.storageId).catch(() => {});
      await ctx.db.delete(build._id);
      spent += 1 + build.files.length / 8;
    }
    if (exhausted()) return void (await reschedule(ctx, projectId));

    // GIF reactions own storage when uploaded; delete blob-first like
    // messages' images, so nothing is stranded unreachable.
    const gifRows = await ctx.db
      .query("gifReactions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(BUDGET - spent);
    for (const gif of gifRows) {
      if (gif.storageId) await ctx.storage.delete(gif.storageId).catch(() => {});
      await ctx.db.delete(gif._id);
      spent += 1;
    }
    if (exhausted()) return void (await reschedule(ctx, projectId));

    // Each thunk carries a literal table name so Convex resolves its by_project
    // index; a dynamic string would erase that typing.
    const directQueries = [
      () => ctx.db.query("frames").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("repoLinks").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("annotations").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("annotationRuns").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("annotationEdits").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("deploys").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("deploymentSamples").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("projectPins").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("presence").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("flowEdges").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("flowCrawls").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("cursors").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("reactions").withIndex("by_project", (q) => q.eq("projectId", projectId)),
      () => ctx.db.query("frameVotes").withIndex("by_project", (q) => q.eq("projectId", projectId)),
    ];
    for (const build of directQueries) {
      const rows = await build().take(BUDGET - spent);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        spent += 1;
      }
      if (exhausted()) return void (await reschedule(ctx, projectId));
    }

    // Nothing hit the budget: the project is fully swept. (If any table still
    // had rows we would have rescheduled above.)
  },
});

async function reschedule(ctx: MutationCtx, projectId: Id<"projects">): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.projects.cascadeDeleteProject, { projectId });
}

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

// DEPRECATED shell: machine-local paths live in repoLinks. The last writer of
// project.repoPath is retired; this stays as a no-op only so a stale client
// calling it gets silence instead of a crash. Delete once ≤0.2.107 is gone.
export const setRepoPath = mutation({
  args: {
    projectId: v.id("projects"),
    repoPath: v.string(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, repoPath: _ignored, ...viewer }) => {
    await requireProjectAccess(ctx, projectId, viewer);
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
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, framework, frames, relayout, brandColors, ...viewer }) => {
    await requireProjectAccess(ctx, projectId, viewer);
    if (framework) await ctx.db.patch(projectId, { framework });
    if (brandColors) await ctx.db.patch(projectId, { brandColors });
    const existing = await ctx.db
      .query("frames")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    // Only canonical frames reconcile against discovered routes. Hand-made
    // copies and what-if variants share a routePath but keep their own place —
    // reconciliation must never move or absorb them.
    const knownByRoute = new Map(
      existing.filter((f) => f.routePath && !f.copyOf && !f.variantOf).map((f) => [f.routePath, f])
    );
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

/**
 * A what-if variant (exploration): the same route, rendered from an agent
 * draft branch, placed beside its original. The variant is a real frame —
 * comments, reactions, votes, and A/B tests all work on it unchanged — whose
 * pixels come from the branch preview instead of the project preview.
 *
 * Placement stacks rightward from the original so four what-ifs read as a
 * crit wall. Never invented: this is only called once an agent draft has
 * actually reported its branch.
 */
export const addVariant = mutation({
  args: {
    variantOf: v.id("frames"),
    prompt: v.string(),
    branch: v.string(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { variantOf, prompt, branch, ...viewer }) => {
    const original = await ctx.db.get(variantOf);
    if (!original) throw new Error("That screen is gone.");
    await requireProjectAccess(ctx, original.projectId, viewer);
    const siblings = await ctx.db
      .query("frames")
      .withIndex("by_project", (q) => q.eq("projectId", original.projectId))
      .collect();
    const existing = siblings.filter((f) => f.variantOf === variantOf).length;
    const title = prompt.length > 48 ? prompt.slice(0, 45) + "…" : prompt;
    return await ctx.db.insert("frames", {
      projectId: original.projectId,
      kind: "route",
      title,
      section: original.section,
      routePath: original.routePath,
      variantOf,
      variantPrompt: prompt,
      variantBranch: branch,
      x: original.x + (original.width + 48) * (existing + 1),
      y: original.y,
      width: original.width,
      height: original.height,
    });
  },
});

/**
 * What a pasted share link shows the room (Slack, Notion, iMessage): the
 * project's name and the home screen's latest snapshot. The unfurl is the
 * product's first impression in most channels it will ever appear in.
 */
export const ogForShareToken = internalQuery({
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
    const home =
      frames.find((f) => f.kind === "route" && (f.routePath ?? "") === "/") ??
      frames.find((f) => f.kind === "route");
    let imageUrl: string | null = null;
    if (home) {
      const snapshot = await ctx.db
        .query("frameSnapshots")
        .withIndex("by_frame", (q) => q.eq("frameId", home._id))
        .unique();
      if (snapshot) imageUrl = await ctx.storage.getUrl(snapshot.storageId);
    }
    return { name: project.name, imageUrl };
  },
});

/** Capabilities learned by inspecting the working copy (self-healing on open). */
export const setSupportsDarkMode = mutation({
  args: {
    projectId: v.id("projects"),
    supportsDarkMode: v.boolean(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, supportsDarkMode, ...viewer }) => {
    await requireProjectAccess(ctx, projectId, viewer);
    await ctx.db.patch(projectId, { supportsDarkMode });
  },
});

/** The ledger's memory: what the last runtime survey found. */
export const recordSurvey = mutation({
  args: {
    projectId: v.id("projects"),
    report: v.object({
      at: v.number(),
      pagesVisited: v.number(),
      proposed: v.number(),
      gatedRoutes: v.array(v.string()),
      unresolvedDynamic: v.array(v.string()),
    }),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, report, ...viewer }) => {
    await requireProjectAccess(ctx, projectId, viewer);
    await ctx.db.patch(projectId, { surveyReport: report });
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
  args: {
    projectId: v.id("projects"),
    gitRemote: v.string(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, gitRemote, ...viewer }) => {
    await requireProjectAccess(ctx, projectId, viewer);
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
    // Optional like every other mutation in this file: the access check below
    // is what gates the write, so an old client that omits these fails on
    // "no access" rather than on argument validation.
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { projectId, previewUrl, branchPreviewPattern, hasBranchPattern } = args;
    const project = await accessibleProject(ctx, projectId, await resolveViewer(ctx, args));
    if (!project) throw new Error("You don't have access to this project.");
    const pattern = hasBranchPattern ? branchPreviewPattern || undefined : project.branchPreviewPattern;

    /**
     * Typing a value here makes it yours, and dropping the provenance is what
     * makes that stick: applyDeploy only writes over values it set itself.
     *
     * Keyed on what actually changed, not on what was submitted — the draft-
     * pattern form passes the preview URL through untouched, and that must not
     * disown a URL the person never edited.
     */
    await ctx.db.patch(projectId, {
      previewUrl,
      ...(previewUrl !== project.previewUrl ? { previewSource: undefined } : {}),
      ...(hasBranchPattern ? { branchPreviewPattern: pattern } : {}),
      ...(pattern !== project.branchPreviewPattern ? { branchPatternSource: undefined } : {}),
    });
  },
});

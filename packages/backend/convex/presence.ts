import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { accessibleProject, requireViewer, resolveViewer } from "./access";

export const heartbeat = mutation({
  args: { userId: v.id("users"), projectId: v.id("projects"), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { projectId, ...viewer }) => {
    // Presence is an identity claim ("I am here, in this project"), so both
    // halves are proven: who you are from the session, then whether you can
    // see the project. The resolved id is what gets written, never the claim.
    const userId = await requireViewer(ctx, viewer);
    if (!(await accessibleProject(ctx, projectId, userId))) throw new Error("Not allowed");
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .unique();
    if (existing) {
      // A heartbeat after a >10min gap starts a new visit; remember where the
      // old one ended so the catch-up strip knows what "since last time" means.
      const gap = Date.now() - existing.lastSeenAt;
      await ctx.db.patch(existing._id, {
        lastSeenAt: Date.now(),
        ...(gap > 10 * 60_000 ? { previousVisitAt: existing.lastSeenAt } : {}),
      });
    } else {
      await ctx.db.insert("presence", { userId, projectId, lastSeenAt: Date.now() });
    }
    await ctx.db.patch(userId, { lastSeenAt: Date.now() });
  },
});

// Throttled by the client (~8 writes/s max while the mouse moves).
export const moveCursor = mutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    x: v.number(),
    y: v.number(),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, x, y, ...viewer }) => {
    const userId = await requireViewer(ctx, viewer);
    if (!(await accessibleProject(ctx, projectId, userId))) throw new Error("Not allowed");
    const existing = await ctx.db
      .query("cursors")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { x, y, updatedAt: Date.now() });
    else await ctx.db.insert("cursors", { userId, projectId, x, y, updatedAt: Date.now() });
  },
});

// Fresh teammate cursors on a project's canvas, with display info joined in.
export const cursorsInProject = query({
  args: { projectId: v.id("projects"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { projectId, ...viewer }) => {
    if (!(await accessibleProject(ctx, projectId, await resolveViewer(ctx, viewer)))) return [];
    const cutoff = Date.now() - 30_000;
    const rows = await ctx.db
      .query("cursors")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const fresh = rows.filter((r) => r.updatedAt > cutoff);
    return await Promise.all(
      fresh.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        return {
          userId: row.userId,
          x: row.x,
          y: row.y,
          updatedAt: row.updatedAt,
          name: user?.name ?? "Teammate",
          avatarColor: user?.avatarColor ?? "#9d9da6",
          avatarUrl: user?.avatarUrl,
        };
      })
    );
  },
});

/**
 * Active teammates across every project the viewer can see, in one query —
 * the home grid's avatar stacks subscribe here so heartbeat churn re-runs
 * this small read instead of the whole listWithActivity card query.
 */
export const activeByProject = query({
  args: { userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, viewer) => {
    const viewerId = await resolveViewer(ctx, viewer);
    if (!viewerId) return {};
    const cutoff = Date.now() - 60_000;
    // presence is bounded by (team members × projects) — small by design.
    const rows = (await ctx.db.query("presence").collect()).filter((r) => r.lastSeenAt > cutoff);
    const result: Record<string, { _id: string; name: string; avatarColor: string; avatarUrl?: string }[]> = {};
    for (const row of rows) {
      // Access-check per project so presence never leaks across workspaces.
      if (!(await accessibleProject(ctx, row.projectId, viewerId))) continue;
      const user = await ctx.db.get(row.userId);
      if (!user) continue;
      (result[row.projectId] ??= []).push({
        _id: user._id,
        name: user.name,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl,
      });
    }
    return result;
  },
});

export const activeInProject = query({
  args: { projectId: v.id("projects"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { projectId, ...viewer }) => {
    if (!(await accessibleProject(ctx, projectId, await resolveViewer(ctx, viewer)))) return [];
    const cutoff = Date.now() - 60_000;
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const users = await Promise.all(
      rows.filter((r) => r.lastSeenAt > cutoff).map((r) => ctx.db.get(r.userId))
    );
    return users.filter(Boolean);
  },
});

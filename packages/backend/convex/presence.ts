import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { accessibleProject, resolveViewer } from "./access";

export const heartbeat = mutation({
  args: { userId: v.id("users"), projectId: v.id("projects") },
  handler: async (ctx, { userId, projectId }) => {
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
    } else {
      await ctx.db.insert("presence", { userId, projectId, lastSeenAt: Date.now() });
    }
    await ctx.db.patch(userId, { lastSeenAt: Date.now() });
  },
});

// Throttled by the client (~8 writes/s max while the mouse moves).
export const moveCursor = mutation({
  args: { userId: v.id("users"), projectId: v.id("projects"), x: v.number(), y: v.number() },
  handler: async (ctx, { userId, projectId, x, y }) => {
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

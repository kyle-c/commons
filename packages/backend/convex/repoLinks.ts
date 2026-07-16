import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { accessibleProject } from "./access";

// Record where this user's working copy lives on their machine. One link per
// (user, project); re-linking replaces the path.
export const link = mutation({
  args: { projectId: v.id("projects"), userId: v.id("users"), repoPath: v.string() },
  handler: async (ctx, { projectId, userId, repoPath }) => {
    const existing = await ctx.db
      .query("repoLinks")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { repoPath });
    else await ctx.db.insert("repoLinks", { projectId, userId, repoPath });
  },
});

// Who has a working copy of this project (drives "ask X to publish a preview"
// empty states and the preview nudge).
export const holders = query({
  args: { projectId: v.id("projects"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { projectId, userId }) => {
    if (!(await accessibleProject(ctx, projectId, userId))) return [];
    const links = await ctx.db
      .query("repoLinks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const users = await Promise.all(links.map((link) => ctx.db.get(link.userId)));
    return users
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => ({ userId: u._id, name: u.name }));
  },
});

export const forUser = query({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: (ctx, { projectId, userId }) =>
    ctx.db
      .query("repoLinks")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .unique(),
});

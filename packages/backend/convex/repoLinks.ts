import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { accessibleProject, requireProjectAccess, requireViewer, resolveViewer } from "./access";

/**
 * Working-copy locations, per (user, project, machine). Paths only mean
 * something on the device that wrote them — one row per machine, so a second
 * laptop starts clean with "Get this project" instead of inheriting a path
 * that doesn't exist there. Rows without machineId are pre-0.2.4 legacy:
 * old clients (which never send machineId) keep reading/writing them.
 */

export const link = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    repoPath: v.string(),
    machineId: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, repoPath, machineId, ...claim }) => {
    // A repo link says "this path on my machine is this project". It is
    // recorded against the proven viewer, never against a claimed id.
    await requireProjectAccess(ctx, projectId, claim);
    const userId = await requireViewer(ctx, claim);
    const rows = await ctx.db
      .query("repoLinks")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .collect();
    if (machineId) {
      const mine = rows.find((r) => r.machineId === machineId);
      if (mine) await ctx.db.patch(mine._id, { repoPath });
      else await ctx.db.insert("repoLinks", { projectId, userId, machineId, repoPath });
      // The machine that just linked is on current code — its legacy row (if
      // any) is ambiguous about which device it described. Retire it.
      const legacy = rows.find((r) => !r.machineId);
      if (legacy) await ctx.db.delete(legacy._id);
    } else {
      const legacy = rows.find((r) => !r.machineId);
      if (legacy) await ctx.db.patch(legacy._id, { repoPath });
      else await ctx.db.insert("repoLinks", { projectId, userId, repoPath });
    }
  },
});

// Who has a working copy of this project (drives "ask X to publish a preview"
// empty states and the preview nudge). Deduped: one entry per person, however
// many machines they've linked.
export const holders = query({
  args: { projectId: v.id("projects"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { projectId, ...viewer }) => {
    if (!(await accessibleProject(ctx, projectId, await resolveViewer(ctx, viewer)))) return [];
    const links = await ctx.db
      .query("repoLinks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const userIds = [...new Set(links.map((link) => link.userId))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    return users
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => ({ userId: u._id, name: u.name }));
  },
});

/**
 * Every working copy this viewer has on this machine, as (projectId, path).
 *
 * The reverse of forUser: the port viewer knows a dev server by its repo path
 * and needs the project behind it, so it can act as a switcher. One query for
 * the whole list rather than one per row, since rows can't each hold a hook.
 */
export const mine = query({
  args: {
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
    machineId: v.optional(v.string()),
  },
  handler: async (ctx, { machineId, ...viewer }) => {
    const userId = await resolveViewer(ctx, viewer);
    if (!userId) return [];
    const rows = await ctx.db
      .query("repoLinks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows
      // A path from another laptop would point the switcher at a project whose
      // server isn't the one running here; legacy rows (no machineId) are
      // still offered, as elsewhere.
      .filter((row) => !machineId || !row.machineId || row.machineId === machineId)
      .map((row) => ({ projectId: row.projectId, repoPath: row.repoPath }));
  },
});

export const forUser = query({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
    machineId: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, machineId, ...viewer }) => {
    // Strict identity + project gate, like `holders`: the fallback to the
    // claimed userId let an account-less caller read anyone's local repo path
    // (OS username, directory layout) for any project.
    const userId = await resolveViewer(ctx, viewer);
    if (!userId || !(await accessibleProject(ctx, projectId, userId))) return null;
    const rows = await ctx.db
      .query("repoLinks")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .collect();
    // New clients get exactly their machine's row — never another device's
    // path. Old clients (no machineId) get the legacy row, as before.
    // A legacy row surfaced to a new client is a *candidate*, flagged so the
    // renderer verifies the path is a real working copy on this machine and
    // claims it (link with machineId retires the legacy row) — heals repos
    // linked before v0.2.4 without resurrecting the second-laptop bug.
    if (machineId) {
      const mine = rows.find((r) => r.machineId === machineId);
      if (mine) return mine;
      const legacy = rows.find((r) => !r.machineId);
      return legacy ? { ...legacy, legacy: true as const } : null;
    }
    return rows.find((r) => !r.machineId) ?? null;
  },
});

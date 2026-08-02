import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { accessibleProject, requireViewer, resolveViewer } from "./access";

/**
 * The cheap half of judgment: stamps and dots.
 *
 * Threads are essays; most of what a PM thinks while panning a canvas never
 * becomes one. Reactions are one click (toggle a stamp on a frame), and votes
 * are a budgeted ritual (five dots per person per project, spent one per
 * frame). Both are deliberately shallow: no bodies, no replies, no
 * notifications — the moment they grow those they are threads, and threads
 * already exist.
 */

/** The whole palette. A fixed set, because an emoji picker is a rabbit hole. */
const STAMPS = ["✨", "🔥", "❓", "😬"];

export const VOTE_BUDGET = 5;

export const toggle = mutation({
  args: {
    frameId: v.id("frames"),
    emoji: v.string(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { frameId, emoji, ...viewer }) => {
    const userId = await requireViewer(ctx, viewer);
    if (!STAMPS.includes(emoji)) throw new Error("Not a stamp Commons knows.");
    const frame = await ctx.db.get(frameId);
    if (!frame || !(await accessibleProject(ctx, frame.projectId, userId))) {
      throw new Error("You don't have access to this project.");
    }
    const existing = await ctx.db
      .query("reactions")
      .withIndex("by_frame_user", (q) => q.eq("frameId", frameId).eq("userId", userId))
      .collect();
    const mine = existing.find((r) => r.emoji === emoji);
    if (mine) {
      await ctx.db.delete(mine._id);
      return { on: false };
    }
    await ctx.db.insert("reactions", { projectId: frame.projectId, frameId, userId, emoji });
    return { on: true };
  },
});

/** Every stamp in the project, grouped per frame for the canvas overlay. */
export const forProject = query({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    if (!(await accessibleProject(ctx, args.projectId, viewerId))) return {};
    const rows = await ctx.db
      .query("reactions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const byFrame: Record<string, { emoji: string; count: number; mine: boolean }[]> = {};
    for (const row of rows) {
      const list = (byFrame[row.frameId] ??= []);
      const entry = list.find((e) => e.emoji === row.emoji);
      if (entry) {
        entry.count += 1;
        entry.mine ||= row.userId === viewerId;
      } else {
        list.push({ emoji: row.emoji, count: 1, mine: row.userId === viewerId });
      }
    }
    return byFrame;
  },
});

export const toggleVote = mutation({
  args: {
    frameId: v.id("frames"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { frameId, ...viewer }) => {
    const userId = await requireViewer(ctx, viewer);
    const frame = await ctx.db.get(frameId);
    if (!frame || !(await accessibleProject(ctx, frame.projectId, userId))) {
      throw new Error("You don't have access to this project.");
    }
    const mine = await ctx.db
      .query("frameVotes")
      .withIndex("by_frame_user", (q) => q.eq("frameId", frameId).eq("userId", userId))
      .unique();
    if (mine) {
      await ctx.db.delete(mine._id);
      return { on: false };
    }
    // The budget is what makes a dot mean something: spending one is a
    // choice, and running out is the ritual working as designed.
    const spent = await ctx.db
      .query("frameVotes")
      .withIndex("by_project_user", (q) => q.eq("projectId", frame.projectId).eq("userId", userId))
      .collect();
    if (spent.length >= VOTE_BUDGET) return { on: false, budgetSpent: true };
    await ctx.db.insert("frameVotes", { projectId: frame.projectId, frameId, userId });
    return { on: true };
  },
});

/** Vote tallies per frame, plus how many dots the viewer has left. */
export const votesForProject = query({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    if (!(await accessibleProject(ctx, args.projectId, viewerId))) {
      return { byFrame: {}, votesLeft: 0 };
    }
    const rows = await ctx.db
      .query("frameVotes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const byFrame: Record<string, { count: number; mine: boolean }> = {};
    let mine = 0;
    for (const row of rows) {
      const entry = (byFrame[row.frameId] ??= { count: 0, mine: false });
      entry.count += 1;
      if (row.userId === viewerId) {
        entry.mine = true;
        mine += 1;
      }
    }
    return { byFrame, votesLeft: Math.max(0, VOTE_BUDGET - mine) };
  },
});

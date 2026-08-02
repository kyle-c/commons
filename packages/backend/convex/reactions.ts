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
    // Where it was thrown (relative). Absent = legacy header toggle.
    fx: v.optional(v.number()),
    fy: v.optional(v.number()),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { frameId, emoji, fx, fy, ...viewer }) => {
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
      // Same stamp thrown at a new spot moves it; with no spot, it's a
      // take-back (the legacy toggle, and clicking your own sticker).
      if (fx !== undefined && fy !== undefined) {
        await ctx.db.patch(mine._id, { fx, fy });
        return { on: true };
      }
      await ctx.db.delete(mine._id);
      return { on: false };
    }
    await ctx.db.insert("reactions", { projectId: frame.projectId, frameId, userId, emoji, fx, fy });
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
    // Placed stamps render individually at their spot; legacy rows (no
    // anchor) keep aggregating into the corner cluster.
    const byFrame: Record<
      string,
      { emoji: string; count: number; mine: boolean; fx?: number; fy?: number }[]
    > = {};
    for (const row of rows) {
      const list = (byFrame[row.frameId] ??= []);
      if (row.fx !== undefined && row.fy !== undefined) {
        list.push({ emoji: row.emoji, count: 1, mine: row.userId === viewerId, fx: row.fx, fy: row.fy });
        continue;
      }
      const entry = list.find((e) => e.emoji === row.emoji && e.fx === undefined);
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

/** Remote GIF sources we'll render. Anything else is a link, not a sticker. */
const GIF_URL = /^https:\/\/[^\s]+\.(gif|webp)(\?[^\s]*)?$|^https:\/\/media\d*\.giphy\.com\//i;
const GIFS_PER_FRAME = 8;

/**
 * The fun register: a GIF sticker on a frame's corner. One per person per
 * frame — adding again replaces, so enthusiasm updates instead of stacking.
 * Capped per frame; refusing beats a zoetrope. No Giphy API on purpose:
 * paste the link Giphy's own Share button copies, or upload a file.
 */
export const addGif = mutation({
  args: {
    frameId: v.id("frames"),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    fx: v.optional(v.number()),
    fy: v.optional(v.number()),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { frameId, url, storageId, fx, fy, ...viewer }) => {
    const userId = await requireViewer(ctx, viewer);
    const frame = await ctx.db.get(frameId);
    if (!frame || !(await accessibleProject(ctx, frame.projectId, userId))) {
      throw new Error("You don't have access to this project.");
    }
    if (!url === !storageId) throw new Error("A sticker is a link or an upload, exactly one.");
    if (url && !GIF_URL.test(url.trim())) {
      return { ok: false as const, reason: "not_a_gif" as const };
    }
    const existing = await ctx.db
      .query("gifReactions")
      .withIndex("by_frame", (q) => q.eq("frameId", frameId))
      .collect();
    const mine = existing.find((g) => g.userId === userId);
    if (mine) {
      if (mine.storageId) await ctx.storage.delete(mine.storageId).catch(() => {});
      await ctx.db.delete(mine._id);
    } else if (existing.length >= GIFS_PER_FRAME) {
      if (storageId) await ctx.storage.delete(storageId).catch(() => {});
      return { ok: false as const, reason: "frame_full" as const };
    }
    await ctx.db.insert("gifReactions", {
      projectId: frame.projectId,
      frameId,
      userId,
      url: url?.trim(),
      storageId,
      fx,
      fy,
    });
    return { ok: true as const };
  },
});

export const removeGif = mutation({
  args: { frameId: v.id("frames"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { frameId, ...viewer }) => {
    const userId = await requireViewer(ctx, viewer);
    const mine = await ctx.db
      .query("gifReactions")
      .withIndex("by_frame_user", (q) => q.eq("frameId", frameId).eq("userId", userId))
      .unique();
    if (!mine) return;
    if (mine.storageId) await ctx.storage.delete(mine.storageId).catch(() => {});
    await ctx.db.delete(mine._id);
  },
});

/** Every sticker in the project, resolved to renderable URLs, per frame. */
export const gifsForProject = query({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    if (!(await accessibleProject(ctx, args.projectId, viewerId))) return {};
    const rows = await ctx.db
      .query("gifReactions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const byFrame: Record<string, { src: string; mine: boolean; by: string; fx?: number; fy?: number }[]> = {};
    for (const row of rows) {
      const src = row.url ?? (row.storageId ? await ctx.storage.getUrl(row.storageId) : null);
      if (!src) continue;
      const author = await ctx.db.get(row.userId);
      (byFrame[row.frameId] ??= []).push({
        src,
        mine: row.userId === viewerId,
        by: author?.name ?? "someone",
        fx: row.fx,
        fy: row.fy,
      });
    }
    return byFrame;
  },
});

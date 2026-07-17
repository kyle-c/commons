import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const MAX_ROWS_PER_VERSION = 500; // runaway crash loops must not fill the table

/** Ingest one report (called by the /api/error HTTP route). */
export const report = internalMutation({
  args: {
    version: v.string(),
    surface: v.union(v.literal("main"), v.literal("renderer"), v.literal("react")),
    message: v.string(),
    stack: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("appErrors")
      .withIndex("by_version", (q) => q.eq("version", args.version))
      .collect();
    if (existing.length >= MAX_ROWS_PER_VERSION) return;
    // Crash loops repeat: bump nothing, just skip exact duplicates from the
    // same version seen in the last hour.
    const hourAgo = Date.now() - 3600_000;
    if (existing.some((e) => e.message === args.message && e._creationTime > hourAgo)) return;
    await ctx.db.insert("appErrors", {
      ...args,
      message: args.message.slice(0, 500),
      stack: args.stack?.slice(0, 4000),
    });
  },
});

/** Recent errors for the pilot pulse / headless triage (npx convex run errors:recent). */
export const recent = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("appErrors").order("desc").take(50);
    return rows.map((r) => ({
      at: r._creationTime,
      version: r.version,
      surface: r.surface,
      message: r.message,
      email: r.email,
    }));
  },
});

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Desktop auto-update feed backing the /update/* HTTP routes (http.ts).
 * All functions are internal: publishing happens through
 * scripts/publish-update.mjs, which runs them via `npx convex run` with the
 * CLI's admin credentials — there is no public write path.
 */

export const createUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const publish = internalMutation({
  args: {
    version: v.string(),
    channelYml: v.string(),
    files: v.array(v.object({ name: v.string(), storageId: v.id("_storage"), size: v.number() })),
  },
  handler: async (ctx, args) => {
    // Re-publishing a version replaces it (keeps retries idempotent).
    const existing = await ctx.db
      .query("appReleases")
      .withIndex("by_version", (q) => q.eq("version", args.version))
      .unique();
    if (existing) {
      for (const file of existing.files) await ctx.storage.delete(file.storageId).catch(() => {});
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert("appReleases", { ...args, publishedAt: Date.now() });
  },
});

export const latest = internalQuery({
  args: {},
  handler: async (ctx) => {
    const releases = await ctx.db.query("appReleases").collect();
    if (releases.length === 0) return null;
    return releases.reduce((a, b) => (b.publishedAt > a.publishedAt ? b : a));
  },
});

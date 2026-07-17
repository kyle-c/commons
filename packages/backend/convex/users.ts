import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { resolveViewer } from "./access";

// Users are created by Google sign-in (auth.completeGoogleSignIn), never here.

export const get = query({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) => ctx.db.get(userId),
});

// With viewer args: only people who share a workspace with you (plus
// yourself) — names/emails must not leak across workspaces. Bare calls
// (shipped ≤0.2.2 clients) keep the old all-users behavior.
export const list = query({
  args: { userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    if (!viewerId) return await ctx.db.query("users").collect();
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", viewerId))
      .collect();
    const visible = new Set<string>([viewerId]);
    for (const membership of memberships) {
      const peers = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
        .collect();
      for (const peer of peers) visible.add(peer.userId);
    }
    const users = await Promise.all([...visible].map((id) => ctx.db.get(id as Id<"users">)));
    return users.filter((u): u is NonNullable<(typeof users)[number]> => u !== null);
  },
});

// Custom avatar upload: client POSTs the image to this URL, then calls
// setAvatarImage with the returned storageId.
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: (ctx) => ctx.storage.generateUploadUrl(),
});

export const setAvatarImage = mutation({
  args: { userId: v.id("users"), storageId: v.id("_storage") },
  handler: async (ctx, { userId, storageId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found.");
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Uploaded image not found.");
    // Replace any previous custom photo so orphaned files don't accumulate.
    if (user.avatarStorageId) await ctx.storage.delete(user.avatarStorageId);
    await ctx.db.patch(userId, { avatarStorageId: storageId, avatarUrl: url });
  },
});

// Back to the Google profile photo (the default).
export const resetAvatar = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return;
    if (user.avatarStorageId) await ctx.storage.delete(user.avatarStorageId);
    await ctx.db.patch(userId, { avatarStorageId: undefined, avatarUrl: user.googleAvatarUrl });
  },
});

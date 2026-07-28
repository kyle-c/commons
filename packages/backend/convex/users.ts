import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireViewer, resolveViewer } from "./access";

// Users are created by Google sign-in (auth.completeGoogleSignIn), never here.

/**
 * A teammate's profile. Signed-in callers only, and only the fields the UI
 * actually renders — the raw document carries the email address and the
 * sign-in provider's avatar, which a name-and-face lookup has no business
 * handing out. Your own row comes back whole.
 */
export const get = query({
  args: { userId: v.id("users"), viewerId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { userId, viewerId, sessionToken }) => {
    const viewer = await requireViewer(ctx, { userId: viewerId, sessionToken });
    const user = await ctx.db.get(userId);
    if (!user) return null;
    if (viewer === userId) return user;
    return {
      _id: user._id,
      _creationTime: user._creationTime,
      name: user.name,
      avatarUrl: user.avatarUrl,
      avatarColor: user.avatarColor,
      lastSeenAt: user.lastSeenAt,
    };
  },
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
// Signed-in only: an open upload-URL minter lets anyone host arbitrary files
// on this deployment's storage, under your domain and on your bill.
export const generateAvatarUploadUrl = mutation({
  args: { userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireViewer(ctx, args);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setAvatarImage = mutation({
  args: { userId: v.id("users"), storageId: v.id("_storage"), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { storageId, ...viewer }) => {
    // Your face, your row. Anyone could previously repaint anyone's avatar,
    // which in a review tool is impersonation with real weight.
    const userId = await requireViewer(ctx, viewer);
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
  args: { userId: v.id("users"), sessionToken: v.optional(v.string()) },
  handler: async (ctx, viewerArgs) => {
    const userId = await requireViewer(ctx, viewerArgs);
    const user = await ctx.db.get(userId);
    if (!user) return;
    if (user.avatarStorageId) await ctx.storage.delete(user.avatarStorageId);
    await ctx.db.patch(userId, { avatarStorageId: undefined, avatarUrl: user.googleAvatarUrl });
  },
});

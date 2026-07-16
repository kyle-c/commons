import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Users are created by Google sign-in (auth.completeGoogleSignIn), never here.

export const get = query({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) => ctx.db.get(userId),
});

export const list = query({
  args: {},
  handler: (ctx) => ctx.db.query("users").collect(),
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

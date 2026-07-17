import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// Invite a teammate by email. Sign-in is invite-gated (see auth.completeGoogleSignIn),
// so this is what actually opens the door; the email is a courtesy nudge.
export const create = mutation({
  args: { email: v.string(), invitedBy: v.id("users") },
  handler: async (ctx, { email, invitedBy }) => {
    const normalized = email.trim().toLowerCase();
    if (!/.+@.+\..+/.test(normalized)) return { ok: false as const, reason: "invalid_email" as const };
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    if (existingUser) return { ok: false as const, reason: "already_member" as const };
    const existingSecondary = await ctx.db
      .query("userEmails")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    if (existingSecondary) return { ok: false as const, reason: "already_member" as const };
    const existingInvite = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    if (existingInvite) return { ok: false as const, reason: "already_invited" as const };

    await ctx.db.insert("invites", { email: normalized, invitedBy });
    const inviter = await ctx.db.get(invitedBy);
    await ctx.scheduler.runAfter(0, internal.emails.sendInviteEmail, {
      email: normalized,
      inviterName: inviter?.name ?? "A teammate",
    });
    return { ok: true as const };
  },
});

// Invites that haven't been accepted yet, with who sent them.
export const pending = query({
  args: {},
  handler: async (ctx) => {
    const invites = await ctx.db.query("invites").collect();
    return await Promise.all(
      invites
        .filter((i) => !i.acceptedAt)
        .map(async (i) => ({ ...i, inviter: await ctx.db.get(i.invitedBy) }))
    );
  },
});

export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
    if (invite && !invite.acceptedAt) await ctx.db.delete(inviteId);
  },
});

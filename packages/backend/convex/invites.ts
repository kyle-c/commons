import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { canAccessProject, requireViewer, resolveViewer } from "./access";

// Invite a teammate by email. Sign-in is invite-gated (see auth.completeGoogleSignIn),
// so this is what actually opens the door; the email is a courtesy nudge.
export const create = mutation({
  args: {
    email: v.string(),
    invitedBy: v.id("users"),
    // ID-11: an invite sent from inside a project carries it, so the email
    // deep-links into that canvas and acceptance lands in its workspace.
    projectId: v.optional(v.id("projects")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { email, projectId, ...claim }) => {
    const invitedBy = await requireViewer(ctx, { userId: claim.invitedBy, sessionToken: claim.sessionToken });
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

    // A project invite must come from someone who can actually see the
    // project, and it carries the project's workspace so acceptance lands
    // the invitee where the work is rather than in an empty playground.
    let project = null;
    if (projectId) {
      project = await ctx.db.get(projectId);
      if (!project || !(await canAccessProject(ctx, project, invitedBy))) {
        return { ok: false as const, reason: "invalid_email" as const };
      }
    }
    await ctx.db.insert("invites", {
      email: normalized,
      invitedBy,
      workspaceId: project?.workspaceId,
    });
    const inviter = await ctx.db.get(invitedBy);
    await ctx.scheduler.runAfter(0, internal.emails.sendInviteEmail, {
      email: normalized,
      inviterName: inviter?.name ?? "A teammate",
      projectId: projectId ?? undefined,
      projectName: project?.name,
    });
    return { ok: true as const };
  },
});

// Invites that haven't been accepted yet, with who sent them.
// Invite records carry email addresses, so this is signed-in only.
export const pending = query({
  args: { userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Fails soft, not loud: a throwing query takes the whole render down
    // with it, and a client whose token hasn't loaded yet would white-screen
    // instead of showing an empty panel. Returning nothing leaks nothing.
    if (!(await resolveViewer(ctx, args))) return [];
    const invites = await ctx.db.query("invites").collect();
    return await Promise.all(
      invites
        .filter((i) => !i.acceptedAt)
        .map(async (i) => ({ ...i, inviter: await ctx.db.get(i.invitedBy) }))
    );
  },
});

export const revoke = mutation({
  args: { inviteId: v.id("invites"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { inviteId, ...viewer }) => {
    await requireViewer(ctx, viewer);
    const invite = await ctx.db.get(inviteId);
    if (invite && !invite.acceptedAt) await ctx.db.delete(inviteId);
  },
});

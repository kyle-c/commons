import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveViewer } from "./access";

/**
 * Workspaces: the isolation boundary. Team workspaces are created explicitly
 * (never inferred) and may carry a corporate domain for auto-join at sign-in;
 * every user gets a personal "playground" workspace automatically.
 */

// Consumer domains never form a team — two strangers with gmail addresses
// must not land in the same workspace.
const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "hey.com",
]);

export async function isMember(
  ctx: { db: MutationCtx["db"] },
  workspaceId: Id<"workspaces">,
  userId: Id<"users">
): Promise<boolean> {
  const row = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user_workspace", (q) => q.eq("userId", userId).eq("workspaceId", workspaceId))
    .unique();
  return row !== null;
}

async function addMembership(ctx: MutationCtx, workspaceId: Id<"workspaces">, userId: Id<"users">): Promise<void> {
  if (!(await isMember(ctx, workspaceId, userId))) {
    await ctx.db.insert("workspaceMembers", { workspaceId, userId });
  }
}

/** Personal playground; created at sign-in (and by migrateLegacy for existing users). */
export async function ensurePersonalWorkspace(ctx: MutationCtx, user: Doc<"users">): Promise<Id<"workspaces">> {
  if (user.personalWorkspaceId) return user.personalWorkspaceId;
  const workspaceId = await ctx.db.insert("workspaces", {
    name: `${user.name.split(" ")[0]}'s playground`,
    kind: "personal",
    createdBy: user._id,
  });
  await ctx.db.insert("workspaceMembers", { workspaceId, userId: user._id });
  await ctx.db.patch(user._id, { personalWorkspaceId: workspaceId });
  return workspaceId;
}

/** Corporate-domain auto-join for one address — runs per email a user proves. */
export async function autoJoinForEmail(ctx: MutationCtx, userId: Id<"users">, email: string): Promise<void> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || CONSUMER_DOMAINS.has(domain)) return;
  const domainWorkspace = await ctx.db
    .query("workspaces")
    .withIndex("by_domain", (q) => q.eq("domain", domain))
    .unique();
  if (domainWorkspace) await addMembership(ctx, domainWorkspace._id, userId);
}

/** Sign-in hook: personal workspace + corporate-domain auto-join + invite-carried workspace. */
export async function onSignIn(
  ctx: MutationCtx,
  user: Doc<"users">,
  inviteWorkspaceId?: Id<"workspaces">
): Promise<void> {
  await ensurePersonalWorkspace(ctx, user);
  await autoJoinForEmail(ctx, user._id, user.email);
  if (inviteWorkspaceId && (await ctx.db.get(inviteWorkspaceId))) {
    await addMembership(ctx, inviteWorkspaceId, user._id);
  }
}

export const create = mutation({
  args: {
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
    name: v.string(),
    domain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    if (!userId) return { ok: false as const, reason: "not_signed_in" as const };
    const name = args.name.trim();
    if (!name) return { ok: false as const, reason: "invalid_name" as const };
    const domain = args.domain?.trim().toLowerCase().replace(/^@/, "") || undefined;
    if (domain) {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { ok: false as const, reason: "invalid_domain" as const };
      if (CONSUMER_DOMAINS.has(domain)) return { ok: false as const, reason: "consumer_domain" as const };
      const taken = await ctx.db
        .query("workspaces")
        .withIndex("by_domain", (q) => q.eq("domain", domain))
        .unique();
      if (taken) return { ok: false as const, reason: "domain_taken" as const };
    }
    const workspaceId = await ctx.db.insert("workspaces", { name, kind: "team", domain, createdBy: userId });
    await ctx.db.insert("workspaceMembers", { workspaceId, userId });
    // Existing users on the domain join immediately, not on next sign-in —
    // matching on primary and linked secondary addresses alike.
    if (domain) {
      const users = await ctx.db.query("users").collect();
      for (const user of users) {
        if (user.email.endsWith(`@${domain}`)) await addMembership(ctx, workspaceId, user._id);
      }
      const secondaries = await ctx.db.query("userEmails").collect();
      for (const row of secondaries) {
        if (row.email.endsWith(`@${domain}`)) await addMembership(ctx, workspaceId, row.userId);
      }
    }
    return { ok: true as const, workspaceId };
  },
});

/** The viewer's workspaces, personal first, with member profiles. */
export const mine = query({
  args: { userId: v.id("users"), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const workspaces = await Promise.all(
      memberships.map(async (m) => {
        const workspace = await ctx.db.get(m.workspaceId);
        if (!workspace) return null;
        const members = await ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
          .collect();
        const profiles = (await Promise.all(members.map((row) => ctx.db.get(row.userId)))).filter(
          (u): u is Doc<"users"> => u !== null
        );
        return { ...workspace, members: profiles };
      })
    );
    return workspaces
      .filter((w): w is NonNullable<typeof w> => w !== null)
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "personal" ? -1 : 1));
  },
});

/**
 * Add someone to a team workspace by email. Existing users join immediately;
 * unknown emails get an app invite that carries the workspace.
 */
export const addMember = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    if (!userId) return { ok: false as const, reason: "not_signed_in" as const };
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace || workspace.kind !== "team") return { ok: false as const, reason: "not_a_team" as const };
    if (!(await isMember(ctx, workspace._id, userId))) return { ok: false as const, reason: "not_a_member" as const };
    const email = args.email.trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) return { ok: false as const, reason: "invalid_email" as const };

    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) {
      await addMembership(ctx, workspace._id, existing._id);
      return { ok: true as const, joined: true as const };
    }
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (invite) {
      await ctx.db.patch(invite._id, { workspaceId: workspace._id });
    } else {
      await ctx.db.insert("invites", { email, invitedBy: userId, workspaceId: workspace._id });
    }
    return { ok: true as const, joined: false as const };
  },
});

/** Move a project between workspaces the mover belongs to (creator-only). */
export const moveProject = mutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) throw new Error("Only the project creator can move it");
    if (!(await isMember(ctx, args.workspaceId, userId))) throw new Error("You're not in that workspace");
    await ctx.db.patch(args.projectId, { workspaceId: args.workspaceId });
  },
});

/**
 * One-time migration: every user gets a personal workspace; every project
 * without a workspace lands in its creator's personal one (fail closed —
 * team projects are then moved out explicitly via the UI).
 * Run: npx convex run workspaces:migrateLegacy [--prod]
 */
export const migrateLegacy = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    for (const user of users) await ensurePersonalWorkspace(ctx, user);
    const projects = await ctx.db.query("projects").collect();
    let moved = 0;
    for (const project of projects) {
      if (project.workspaceId) continue;
      const creator = await ctx.db.get(project.createdBy);
      if (!creator?.personalWorkspaceId) continue;
      await ctx.db.patch(project._id, { workspaceId: creator.personalWorkspaceId });
      moved++;
    }
    return { users: users.length, projectsAssigned: moved };
  },
});

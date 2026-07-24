import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { onSignIn, autoJoinForEmail } from "./workspaces";
import { resolveViewer } from "./access";

const AVATAR_COLORS = ["#f97316", "#22d3ee", "#a78bfa", "#4ade80", "#f472b6", "#facc15", "#60a5fa", "#fb7185"];

// A browser sign-in must complete within this window.
const AUTH_SESSION_TTL_MS = 10 * 60 * 1000;

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Google OAuth, authorization-code flow. The app never sees Google credentials:
// the browser lands on our HTTP action (http.ts), which exchanges the code with
// the client secret held in Convex env vars, then hands the app a session token
// via the commons:// callback / the live `status` query. `state` is a 128-bit
// server-generated nonce, so it both prevents CSRF and stands in for PKCE —
// the exchange happens on the same backend that generated it.
export const start = mutation({
  args: {
    // Link mode: prove ownership of an additional email for the account
    // behind this session token — same OAuth flow, no new session minted.
    linkSessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { linkSessionToken }) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error("GOOGLE_CLIENT_ID is not set on the Convex deployment — see README, 'Google sign-in setup'.");
    }
    let linkUserId: Id<"users"> | undefined;
    if (linkSessionToken) {
      const session = await ctx.db
        .query("sessions")
        .withIndex("by_token", (q) => q.eq("token", linkSessionToken))
        .unique();
      if (!session) throw new Error("Sign in again before linking an email.");
      linkUserId = session.userId;
    }
    // Opportunistic cleanup: this table only holds in-flight sign-ins.
    const now = Date.now();
    for (const stale of await ctx.db.query("authSessions").collect()) {
      if (stale.expiresAt < now || stale.status === "claimed") await ctx.db.delete(stale._id);
    }
    const state = randomToken(16);
    await ctx.db.insert("authSessions", { state, status: "pending", expiresAt: now + AUTH_SESSION_TTL_MS, linkUserId });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${process.env.CONVEX_SITE_URL}/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    return { state, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  },
});

/**
 * Magic-link sign-in (client-friendly: no OAuth apps, no Google/Microsoft
 * account needed). Same gate as Google — the email must already belong to a
 * user (primary or linked) or hold an invite; bootstrap stays Google-only.
 * The app polls auth.status with the returned state, exactly like OAuth.
 */
export const startEmailSignIn = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) return { ok: false as const, reason: "invalid_email" as const };
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    const secondary = existingUser
      ? null
      : await ctx.db
          .query("userEmails")
          .withIndex("by_email", (q) => q.eq("email", email))
          .unique();
    const invite =
      existingUser || secondary
        ? null
        : await ctx.db
            .query("invites")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique();
    if (!existingUser && !secondary && !invite) return { ok: false as const, reason: "not_invited" as const };

    const now = Date.now();
    const state = randomToken(16);
    const emailToken = randomToken(24);
    await ctx.db.insert("authSessions", {
      state,
      status: "pending",
      expiresAt: now + 15 * 60 * 1000,
      email,
      emailToken,
    });
    await ctx.scheduler.runAfter(0, internal.emails.sendMagicLinkEmail, {
      email,
      link: `${process.env.CONVEX_SITE_URL}/auth/email/callback?token=${emailToken}`,
    });
    return { ok: true as const, state };
  },
});

/** The emailed link lands here (via the HTTP route): authorize + mint a session. */
export const completeEmailSignIn = internalMutation({
  args: { emailToken: v.string() },
  handler: async (ctx, { emailToken }) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_email_token", (q) => q.eq("emailToken", emailToken))
      .unique();
    if (!session || session.status !== "pending" || session.expiresAt < Date.now() || !session.email) {
      return { ok: false as const };
    }
    const email = session.email;

    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) {
      const viaSecondary = await ctx.db
        .query("userEmails")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (viaSecondary) user = await ctx.db.get(viaSecondary.userId);
    }
    let inviteWorkspaceId: Id<"workspaces"> | undefined;
    if (!user) {
      // Invited but new: create the account (name from the address; they can
      // fix it later — Google sign-in refreshes it if they ever use that).
      const invite = await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (!invite) {
        await ctx.db.patch(session._id, { status: "failed", error: "not_invited" });
        return { ok: false as const };
      }
      const count = (await ctx.db.query("users").collect()).length;
      const userId = await ctx.db.insert("users", {
        name: email.split("@")[0],
        email,
        avatarColor: AVATAR_COLORS[count % AVATAR_COLORS.length],
        lastSeenAt: Date.now(),
      });
      user = (await ctx.db.get(userId))!;
      if (!invite.acceptedAt) {
        await ctx.db.patch(invite._id, { acceptedAt: Date.now() });
        inviteWorkspaceId = invite.workspaceId;
      }
    } else {
      await ctx.db.patch(user._id, { lastSeenAt: Date.now() });
    }
    await onSignIn(ctx, user, inviteWorkspaceId);

    const token = randomToken(32);
    await ctx.db.insert("sessions", { userId: user._id, token });
    // Burn the email token; the app claims via state as usual.
    await ctx.db.patch(session._id, {
      status: "authorized",
      userId: user._id,
      sessionToken: token,
      emailToken: undefined,
    });
    return { ok: true as const, state: session.state };
  },
});

// The sign-in screen subscribes to this while the browser flow is in flight.
export const status = query({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!session || session.expiresAt < Date.now()) return null;
    return { status: session.status, error: session.error };
  },
});

// One-time exchange of an authorized browser sign-in for a session token.
export const claim = mutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!session || session.status !== "authorized" || session.expiresAt < Date.now()) return null;
    if (!session.userId || !session.sessionToken) return null;
    await ctx.db.patch(session._id, { status: "claimed", sessionToken: undefined });
    return { userId: session.userId, token: session.sessionToken };
  },
});

// Called on app launch with the stored token; null means "sign in again".
export const validate = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", sessionToken))
      .unique();
    if (!session) return null;
    return await ctx.db.get(session.userId);
  },
});

export const touch = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", sessionToken))
      .unique();
    if (session) await ctx.db.patch(session.userId, { lastSeenAt: Date.now() });
  },
});

// Linked secondary addresses for the account menu.
export const linkedEmails = query({
  args: { userId: v.id("users"), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    if (!userId) return [];
    const rows = await ctx.db
      .query("userEmails")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => ({ id: row._id, email: row.email }));
  },
});

// Unlinking removes the sign-in path, not any workspace memberships the
// address earned — leaving a company shouldn't silently eject you mid-project.
export const unlinkEmail = mutation({
  args: { emailId: v.id("userEmails"), userId: v.id("users"), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    const row = await ctx.db.get(args.emailId);
    if (!row || !userId || row.userId !== userId) throw new Error("Not your linked email");
    await ctx.db.delete(args.emailId);
  },
});

export const signOut = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", sessionToken))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

// Called by the Google callback HTTP action once it has a verified profile.
// Membership rule: the very first sign-in bootstraps the team; after that an
// email must already be a member or hold an invite.
export const completeGoogleSignIn = internalMutation({
  args: {
    state: v.string(),
    email: v.string(),
    name: v.string(),
    googleId: v.string(),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, { state, email, name, googleId, avatarUrl }) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!session || session.status !== "pending" || session.expiresAt < Date.now()) {
      return { ok: false as const, reason: "expired" as const };
    }

    const normalized = email.toLowerCase();

    // Link mode: Google just proved the signer owns `normalized` — attach it
    // to the linking account instead of signing anyone in.
    if (session.linkUserId) {
      const linker = await ctx.db.get(session.linkUserId);
      if (!linker) {
        await ctx.db.patch(session._id, { status: "failed", error: "link_account_gone" });
        return { ok: false as const, reason: "expired" as const };
      }
      const ownedByPrimary = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", normalized))
        .unique();
      const ownedBySecondary = await ctx.db
        .query("userEmails")
        .withIndex("by_email", (q) => q.eq("email", normalized))
        .unique();
      if (ownedByPrimary?._id === linker._id || ownedBySecondary?.userId === linker._id) {
        await ctx.db.patch(session._id, { status: "authorized", userId: linker._id });
        return { ok: true as const, linked: true as const, email: normalized };
      }
      if (ownedByPrimary || ownedBySecondary) {
        await ctx.db.patch(session._id, { status: "failed", error: "email_in_use" });
        return { ok: false as const, reason: "email_in_use" as const };
      }
      await ctx.db.insert("userEmails", { userId: linker._id, email: normalized });
      // The new address opens the same doors a sign-in with it would have:
      // pending invite accepted (with any carried workspace) + domain auto-join.
      const invite = await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", normalized))
        .unique();
      if (invite && !invite.acceptedAt) {
        await ctx.db.patch(invite._id, { acceptedAt: Date.now() });
        if (invite.workspaceId) await onSignIn(ctx, linker, invite.workspaceId);
      }
      await autoJoinForEmail(ctx, linker._id, normalized);
      await ctx.db.patch(session._id, { status: "authorized", userId: linker._id });
      return { ok: true as const, linked: true as const, email: normalized };
    }

    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    // A linked secondary address signs in to the account it belongs to.
    const viaSecondary = user
      ? null
      : await ctx.db
          .query("userEmails")
          .withIndex("by_email", (q) => q.eq("email", normalized))
          .unique();
    if (!user && viaSecondary) {
      user = await ctx.db.get(viaSecondary.userId);
      // Don't refresh the profile from a secondary Google account — its
      // name/photo belong to a different Google identity than the primary.
      if (user) {
        await ctx.db.patch(user._id, { lastSeenAt: Date.now() });
        await onSignIn(ctx, user);
        const token = randomToken(32);
        await ctx.db.insert("sessions", { userId: user._id, token });
        await ctx.db.patch(session._id, { status: "authorized", userId: user._id, sessionToken: token });
        return { ok: true as const };
      }
    }
    let inviteWorkspaceId: Id<"workspaces"> | undefined;

    if (user) {
      // Keep the Google photo fresh, but never clobber a custom upload.
      await ctx.db.patch(user._id, {
        name,
        googleId,
        googleAvatarUrl: avatarUrl,
        ...(user.avatarStorageId ? {} : { avatarUrl }),
        lastSeenAt: Date.now(),
      });
    } else {
      const invite = await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", normalized))
        .unique();
      const anyUser = await ctx.db.query("users").first();
      if (!invite && anyUser) {
        await ctx.db.patch(session._id, { status: "failed", error: "not_invited" });
        return { ok: false as const, reason: "not_invited" as const };
      }
      const count = (await ctx.db.query("users").collect()).length;
      const userId = await ctx.db.insert("users", {
        name,
        email: normalized,
        avatarColor: AVATAR_COLORS[count % AVATAR_COLORS.length],
        lastSeenAt: Date.now(),
        googleId,
        avatarUrl,
        googleAvatarUrl: avatarUrl,
      });
      user = (await ctx.db.get(userId))!;
      if (invite && !invite.acceptedAt) {
        await ctx.db.patch(invite._id, { acceptedAt: Date.now() });
        inviteWorkspaceId = invite.workspaceId;
      }
    }

    // Workspaces: personal playground + corporate-domain auto-join +
    // invite-carried team membership.
    await onSignIn(ctx, user, inviteWorkspaceId);

    const token = randomToken(32);
    await ctx.db.insert("sessions", { userId: user._id, token });
    await ctx.db.patch(session._id, { status: "authorized", userId: user._id, sessionToken: token });
    return { ok: true as const };
  },
});

export const failAuthSession = internalMutation({
  args: { state: v.string(), error: v.string() },
  handler: async (ctx, { state, error }) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (session && session.status === "pending") {
      await ctx.db.patch(session._id, { status: "failed", error });
    }
  },
});

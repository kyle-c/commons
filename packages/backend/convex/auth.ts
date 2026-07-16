import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
  args: {},
  handler: async (ctx) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error("GOOGLE_CLIENT_ID is not set on the Convex deployment — see README, 'Google sign-in setup'.");
    }
    // Opportunistic cleanup: this table only holds in-flight sign-ins.
    const now = Date.now();
    for (const stale of await ctx.db.query("authSessions").collect()) {
      if (stale.expiresAt < now || stale.status === "claimed") await ctx.db.delete(stale._id);
    }
    const state = randomToken(16);
    await ctx.db.insert("authSessions", { state, status: "pending", expiresAt: now + AUTH_SESSION_TTL_MS });
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
    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();

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
      if (invite && !invite.acceptedAt) await ctx.db.patch(invite._id, { acceptedAt: Date.now() });
    }

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

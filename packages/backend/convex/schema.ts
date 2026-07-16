import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row per teammate. Created on first Google sign-in (invite-gated);
  // rows created by the old dev-identity flow are linked up by email.
  users: defineTable({
    name: v.string(),
    email: v.string(),
    avatarColor: v.string(),
    lastSeenAt: v.number(),
    // What the app displays: the custom upload when set, else the Google photo.
    avatarUrl: v.optional(v.string()),
    // Custom uploaded photo (Convex storage). Sign-in never clobbers it.
    avatarStorageId: v.optional(v.id("_storage")),
    // Latest photo from Google sign-in — the default, and the reset target.
    googleAvatarUrl: v.optional(v.string()),
    googleId: v.optional(v.string()),
  }).index("by_email", ["email"]),

  // A signed-in device. The token is held by the desktop app and passed to
  // auth.validate on launch; deleted on sign-out.
  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
  }).index("by_token", ["token"]),

  // One in-flight browser sign-in, keyed by the OAuth `state` param.
  // pending → authorized (Google callback landed) → claimed (app picked up the
  // session token), or failed (not invited / expired / Google error).
  authSessions: defineTable({
    state: v.string(),
    status: v.union(v.literal("pending"), v.literal("authorized"), v.literal("claimed"), v.literal("failed")),
    expiresAt: v.number(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_state", ["state"]),

  // Emails allowed to join on their first Google sign-in.
  invites: defineTable({
    email: v.string(),
    invitedBy: v.id("users"),
    acceptedAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  projects: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
    // Absent = "team" (visible to everyone). Private projects are visible to
    // the creator plus explicitly added memberIds only.
    visibility: v.optional(v.union(v.literal("team"), v.literal("private"))),
    memberIds: v.optional(v.array(v.id("users"))),
    // DEPRECATED: machine-specific paths live in repoLinks now (one per user).
    // Kept so pre-migration documents still validate.
    repoPath: v.optional(v.string()),
    // Canonical identity of the code source; local working copies map to it.
    gitRemote: v.optional(v.string()),
    framework: v.optional(v.string()),
    figmaFileKey: v.optional(v.string()),
    // Deployed preview (e.g. Vercel) — frames fall back to previewUrl + routePath
    // for teammates without a local working copy.
    previewUrl: v.optional(v.string()),
    // Two most prominent colors from the repo's stylesheets — drives the
    // project card cover.
    brandColors: v.optional(v.array(v.string())),
    archivedAt: v.optional(v.number()),
  }),

  // Where each teammate's working copy of a project lives on their machine.
  repoLinks: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    repoPath: v.string(),
  })
    .index("by_user_project", ["userId", "projectId"])
    .index("by_project", ["projectId"]),

  // Agent sessions run on one member's machine (the host) but are mirrored
  // here so the whole team can watch. Events land in agentEvents.
  agentSessions: defineTable({
    projectId: v.id("projects"),
    hostUserId: v.id("users"),
    adapter: v.string(),
    title: v.string(),
    status: v.union(
      v.literal("starting"),
      v.literal("running"),
      v.literal("idle"),
      v.literal("error"),
      v.literal("stopped")
    ),
    threadId: v.optional(v.id("threads")),
    frameId: v.optional(v.id("frames")),
    routePath: v.optional(v.string()),
    editedFiles: v.array(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_host", ["hostUserId"]),

  // Ordered transcript of a mirrored agent session (AgentSessionEvent payloads).
  agentEvents: defineTable({
    sessionId: v.id("agentSessions"),
    event: v.any(),
  }).index("by_session", ["sessionId"]),

  // A frame on the canvas: a route of the code project or a Figma frame.
  frames: defineTable({
    projectId: v.id("projects"),
    kind: v.union(v.literal("route"), v.literal("figma")),
    title: v.string(),
    // IA grouping derived from route structure; drawn as a labeled region.
    section: v.optional(v.string()),
    // kind=route: URL path within the dev server (e.g. "/settings").
    routePath: v.optional(v.string()),
    // kind=figma: node id within the project's Figma file.
    figmaNodeId: v.optional(v.string()),
    // Canvas placement.
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
  }).index("by_project", ["projectId"]),

  threads: defineTable({
    projectId: v.id("projects"),
    // Pinned to a frame at relative coords, or to the canvas at absolute coords.
    frameId: v.optional(v.id("frames")),
    fx: v.optional(v.number()),
    fy: v.optional(v.number()),
    canvasX: v.optional(v.number()),
    canvasY: v.optional(v.number()),
    createdBy: v.id("users"),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_frame", ["frameId"]),

  messages: defineTable({
    threadId: v.id("threads"),
    authorId: v.id("users"),
    body: v.string(),
    mentions: v.array(v.id("users")),
  }).index("by_thread", ["threadId"]),

  // In-app inbox entries created by @mentions.
  notifications: defineTable({
    userId: v.id("users"),
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    readAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // Presence heartbeat per user per project.
  presence: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    lastSeenAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user_project", ["userId", "projectId"]),

  // Live cursor positions on the canvas, in canvas coordinates. Deliberately
  // separate from `presence`: cursor writes are high-churn (~per 120ms while
  // moving) and must not invalidate the avatar-stack / project-list queries.
  cursors: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    x: v.number(),
    y: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user_project", ["userId", "projectId"]),
});

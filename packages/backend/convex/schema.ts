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
    // The user's own playground workspace (kind "personal"), created at sign-in.
    personalWorkspaceId: v.optional(v.id("workspaces")),
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

  // Emails allowed to join on their first Google sign-in. An invite may also
  // carry a workspace: accepting it joins that workspace (how personal-email
  // collaborators get into a team without a matching domain).
  invites: defineTable({
    email: v.string(),
    invitedBy: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    acceptedAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  // Isolation boundary: you see a project only if you're a member of its
  // workspace. "team" workspaces are created explicitly (optionally with a
  // corporate domain — matching sign-ins auto-join); every user also gets a
  // "personal" playground workspace at first sign-in.
  workspaces: defineTable({
    name: v.string(),
    kind: v.union(v.literal("team"), v.literal("personal")),
    // Corporate domain for auto-join ("felixpago.com"). Consumer domains
    // (gmail etc.) are rejected at create — strangers must never share a team.
    domain: v.optional(v.string()),
    createdBy: v.id("users"),
  }).index("by_domain", ["domain"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_user_workspace", ["userId", "workspaceId"]),

  projects: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
    // Which workspace this project belongs to. Absent = pre-workspace legacy
    // row: visible only to its creator until migrateLegacy assigns it.
    workspaceId: v.optional(v.id("workspaces")),
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
    // "{branch}"-templated URL for per-branch deploy previews, e.g.
    // "https://myapp-git-{branch}-team.vercel.app" — lets everyone see an
    // agent draft live before it merges (PRJ-14).
    branchPreviewPattern: v.optional(v.string()),
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
    // Attached images (Convex storage) — e.g. agent before/after snapshots.
    images: v.optional(v.array(v.id("_storage"))),
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

  // Desktop auto-update feed. The newest row is what /update/* serves:
  // channelYml verbatim as latest-mac.yml, files by 302 to Convex storage.
  // Published by scripts/publish-update.mjs after a dist build.
  appReleases: defineTable({
    version: v.string(),
    channelYml: v.string(),
    files: v.array(v.object({ name: v.string(), storageId: v.id("_storage"), size: v.number() })),
    publishedAt: v.number(),
  }).index("by_version", ["version"]),

  // A shareable usability test on a project's deployed preview. Testers open
  // /t/<token> on the Convex site — no Commons account involved. reportToken
  // gates the separate read-only aggregate report at /r/<reportToken>.
  tests: defineTable({
    projectId: v.id("projects"),
    createdBy: v.id("users"),
    title: v.string(),
    token: v.string(),
    reportToken: v.string(),
    status: v.union(v.literal("live"), v.literal("closed")),
    startRoute: v.string(),
    // Tester-side frame size; height 0 = fill the browser (desktop apps).
    device: v.object({ width: v.number(), height: v.number() }),
    tasks: v.array(
      v.object({
        id: v.string(),
        instruction: v.string(),
        // Route pattern that auto-completes the task ("/settings", "/pay/[id]").
        // Absent = self-reported success only.
        targetRoute: v.optional(v.string()),
      })
    ),
    questions: v.array(
      v.object({
        id: v.string(),
        prompt: v.string(),
        // scale = 1–5 opinion scale; text = free response.
        kind: v.union(v.literal("scale"), v.literal("text")),
      })
    ),
    // Variant testing (UT-11): sessions alternate between the project preview
    // ("A · current") and this URL — typically an agent draft's branch preview.
    variant: v.optional(v.object({ label: v.string(), url: v.string() })),
  })
    .index("by_project", ["projectId"])
    .index("by_token", ["token"])
    .index("by_report_token", ["reportToken"]),

  // One tester's run through a test. Task summaries are computed in the
  // harness page and posted at each task boundary; raw events land in
  // testEvents. instrumented flips true once the in-app snippet phones home.
  testSessions: defineTable({
    testId: v.id("tests"),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    instrumented: v.boolean(),
    userAgent: v.optional(v.string()),
    // "a" = project preview, "b" = the test's variant URL (UT-11).
    variant: v.optional(v.union(v.literal("a"), v.literal("b"))),
    tasks: v.array(
      v.object({
        taskId: v.string(),
        outcome: v.union(v.literal("success"), v.literal("gave_up")),
        // true when the target route matched; false = tester clicked "I did it".
        auto: v.boolean(),
        durationMs: v.number(),
        routeSequence: v.array(v.string()),
        clickCount: v.number(),
        misclickCount: v.number(),
      })
    ),
    answers: v.optional(v.array(v.object({ questionId: v.string(), value: v.string() }))),
  }).index("by_test", ["testId"]),

  // Raw instrumentation stream (route changes + clicks — never text input).
  // Click coordinates are normalized by the tester's viewport WIDTH on both
  // axes, so fx/fy scale directly by frame width when drawn on the canvas.
  testEvents: defineTable({
    sessionId: v.id("testSessions"),
    testId: v.id("tests"),
    taskId: v.optional(v.string()),
    kind: v.union(v.literal("route"), v.literal("click")),
    route: v.optional(v.string()),
    fx: v.optional(v.number()),
    fy: v.optional(v.number()),
    // Click landed on something clickable (link/button/input) — false = misclick.
    interactive: v.optional(v.boolean()),
    at: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_test", ["testId"]),

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

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

  // Secondary addresses linked to an account (one identity, many emails —
  // work + personal). Verified by Google: linking runs the OAuth flow with the
  // address being added. Sign-in with any linked address resolves to the same
  // user; workspace domain auto-join fires per address.
  userEmails: defineTable({
    userId: v.id("users"),
    email: v.string(),
  })
    .index("by_email", ["email"])
    .index("by_user", ["userId"]),

  // One in-flight browser sign-in, keyed by the OAuth `state` param.
  // pending → authorized (Google callback landed) → claimed (app picked up the
  // session token), or failed (not invited / expired / Google error).
  authSessions: defineTable({
    state: v.string(),
    status: v.union(v.literal("pending"), v.literal("authorized"), v.literal("claimed"), v.literal("failed")),
    expiresAt: v.number(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
    // Link mode: this flow adds a verified secondary email to an existing
    // account instead of signing in (auth.start with linkSessionToken).
    linkUserId: v.optional(v.id("users")),
    // Magic-link mode: emailed one-time token; clicking the link authorizes
    // this session (no OAuth apps involved — client-friendly).
    email: v.optional(v.string()),
    emailToken: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_state", ["state"])
    .index("by_email_token", ["emailToken"]),

  // Emails allowed to join on their first Google sign-in. An invite may also
  // carry a workspace: accepting it joins that workspace (how personal-email
  // collaborators get into a team without a matching domain).
  invites: defineTable({
    email: v.string(),
    invitedBy: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    acceptedAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  /**
   * One row per project ever auto-created from a deploy — written at
   * creation, never deleted. This is what stops a deleted project from
   * resurrecting on the repo's next deploy: existence of the row means
   * "already offered once, the human's verdict stands".
   *
   * projectId is deliberately a plain string, not v.id("projects"): the row
   * must outlive the project (that is its whole job), so it must NOT join
   * the delete cascade — and typing it as a project reference would make
   * the cascade-coverage test correctly demand that it does.
   */
  githubAutoProjects: defineTable({
    installationId: v.number(),
    repoFullName: v.string(),
    projectId: v.string(),
  }).index("by_install_repo", ["installationId", "repoFullName"]),

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
    // Figma REST access for this workspace's projects: a personal access
    // token pasted by an admin, used only for read endpoints (file nodes,
    // image renders). Same trust posture as the Slack webhook below.
    figmaToken: v.optional(v.string()),
    // Per-workspace Slack channel (incoming webhook) for thread/agent posts.
    slackWebhookUrl: v.optional(v.string()),
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
    // Where previewUrl / branchPreviewPattern came from. "manual" is a human
    // decision and the GitHub listener never overwrites it; "github" was
    // learned from deployment_status events and may be refined as more
    // deploys arrive. Absent = manual (every pre-GitHub-App row).
    previewSource: v.optional(v.union(v.literal("manual"), v.literal("github"))),
    branchPatternSource: v.optional(v.union(v.literal("manual"), v.literal("github"))),
    // Last successful production deploy seen for this project's repo.
    lastDeployAt: v.optional(v.number()),
    // Set when a deploy lands: existing snapshots now show older pixels than
    // the deployed app. A desktop client refreshes them opportunistically.
    snapshotsStaleAt: v.optional(v.number()),
    // Two most prominent colors from the repo's stylesheets — drives the
    // project card cover.
    brandColors: v.optional(v.array(v.string())),
    // Custom uploaded card cover (Convex storage); beats the brand gradient.
    coverImageId: v.optional(v.id("_storage")),
    // Web share (SNAP-4/DL-3 lite): anyone with /p/<shareToken> gets the
    // read-only snapshot canvas + threads. Minted/revoked in Sharing.
    shareToken: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    // Shared lifecycle label ("what kind of feedback is wanted here").
    // Absent = unlabeled; any workspace member can set it from the card.
    status: v.optional(
      v.union(
        v.literal("exploring"),
        v.literal("in-review"),
        v.literal("testing"),
        v.literal("shipped"),
        v.literal("parked")
      )
    ),
  }).index("by_share_token", ["shareToken"]),

  // Where each teammate's working copy of a project lives, per machine —
  // paths only mean something on the device that created them (a stale
  // cross-laptop path is how "dev error on my new laptop" happened).
  // machineId absent = pre-0.2.4 row, readable only by old clients.
  repoLinks: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    machineId: v.optional(v.string()),
    repoPath: v.string(),
  })
    .index("by_user_project", ["userId", "projectId"])
    .index("by_project", ["projectId"])
    // All of one person's working copies, for the port viewer's path -> project
    // lookup (by_user_project needs a projectId you don't have yet).
    .index("by_user", ["userId"]),

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
    // Where the session executes. Absent = the host's machine (the original
    // mode). "actions" = a GitHub Actions run with no host: steering is
    // disabled and everyone is a spectator, which the mirroring model
    // (AG-9) already supports without changes.
    runner: v.optional(v.literal("actions")),
    // Bearer for the remote runner's event callbacks. Proves "I am the run
    // this session dispatched", nothing else; single session scope.
    runToken: v.optional(v.string()),
    // The commons/<slug> branch a cloud run works on.
    branch: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_host", ["hostUserId"])
    .index("by_status", ["status"]),

  // Ordered transcript of a mirrored agent session (AgentSessionEvent payloads).
  agentEvents: defineTable({
    sessionId: v.id("agentSessions"),
    event: v.any(),
  }).index("by_session", ["sessionId"]),

  // Design Context Layer (NAR): one curated rationale claim per row, pinned
  // to a frame (screen-level) or to a named flow. Generated as drafts by an
  // annotation pass on the host's machine, then designer-curated. Nothing
  // reaches stakeholders (canvas layer, share page) until status=approved —
  // inferred intent presented as fact is worse than no annotation.
  annotations: defineTable({
    projectId: v.id("projects"),
    frameId: v.optional(v.id("frames")),
    // Set instead of frameId for flow-level claims ("Send money to family").
    flowTitle: v.optional(v.string()),
    // The claim, in the designer's voice. Curation edits this in place; the
    // pre-edit draft is preserved in annotationEdits.
    text: v.string(),
    // Receipts. Empty array = inferred (the model guessed; the UI says so).
    citations: v.array(
      v.object({
        kind: v.union(
          v.literal("commit"),
          v.literal("doc"),
          v.literal("code"),
          v.literal("thread"),
          v.literal("test")
        ),
        ref: v.string(),
        // Mechanical post-pass: commit hashes checked against the repo.
        verified: v.optional(v.boolean()),
      })
    ),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("rejected")),
    runId: v.id("annotationRuns"),
    // Curator (approve/edit/reject) — the voice being learned (NAR-4 corpus).
    curatorId: v.optional(v.id("users")),
    curatedAt: v.optional(v.number()),
    // Stable ordering within a frame/flow group, as generated.
    order: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_run", ["runId"]),

  // One annotation-generation pass (host machine, Claude on the host's key).
  // Carries the model's own confidence notes — shown atop the review queue as
  // "where I was guessing", doubling as a what-evidence-to-collect-next hint.
  annotationRuns: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
    confidenceNotes: v.optional(v.string()),
    error: v.optional(v.string()),
    draftCount: v.optional(v.number()),
  }).index("by_project", ["projectId"]),

  // The NAR-4 learning corpus: every curation decision as a before/after pair.
  // Logged from day one so voice-profile synthesis has data before it ships.
  annotationEdits: defineTable({
    annotationId: v.id("annotations"),
    projectId: v.id("projects"),
    userId: v.id("users"),
    action: v.union(v.literal("approve"), v.literal("edit"), v.literal("reject")),
    before: v.string(),
    // Same as before on plain approves; empty on rejects.
    after: v.string(),
    // Curator's tagged reason (tone / ordering / concision / wrong), optional.
    reason: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"]),

  // Latest snapshot image per frame (SNAP-3), captured by a host whose dev
  // server is live. Powers the web share page and canvas placeholders.
  // A GitHub App installation on an org or user account. One connect gives
  // Commons the deployment feed for every repo the installation covers.
  githubInstallations: defineTable({
    installationId: v.number(),
    accountLogin: v.string(),
    installedBy: v.optional(v.id("users")),
    workspaceId: v.optional(v.id("workspaces")),
    removedAt: v.optional(v.number()),
    // Repos this installation can actually see ("owner/name"), cached from the
    // API. A query cannot fetch, and this is the difference between "connected,
    // waiting" and "connected, but not to this repo" — a distinction that cost
    // hours to establish by hand. Absent = never synced, so say nothing.
    repositories: v.optional(v.array(v.string())),
    repositoriesSyncedAt: v.optional(v.number()),
  })
    .index("by_installation", ["installationId"])
    .index("by_account", ["accountLogin"])
    .index("by_workspace", ["workspaceId"]),

  // Which workspaces an installation feeds.
  //
  // Many-to-many on purpose: one GitHub account commonly owns repos that live
  // in several workspaces (kyle-c owns both a Felix repo and a playground
  // one). The first cut put a single workspaceId on githubInstallations, so
  // connecting from a second workspace silently *moved* the binding and the
  // first workspace stopped receiving deploys.
  githubWorkspaceLinks: defineTable({
    installationId: v.number(),
    workspaceId: v.id("workspaces"),
    linkedBy: v.id("users"),
  })
    .index("by_installation", ["installationId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_installation_workspace", ["installationId", "workspaceId"]),

  // Short-lived proof that the person GitHub is about to send back to us is
  // the same person who clicked Connect, for the workspace they clicked it in.
  // Without this, anyone could POST an installation_id and adopt someone
  // else's repos. Single-use and expiring, like any OAuth state parameter.
  githubConnectStates: defineTable({
    token: v.string(),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_token", ["token"]),

  // Observed (branch -> preview URL) pairs from deployment_status events.
  // Two or more samples let us infer the {branch} pattern, and we keep them
  // so a later sample can *disprove* a pattern we previously inferred.
  // Every deploy that reached a project, newest first. previewUrl only ever
  // says "now"; this is "and before that". On hosts with immutable
  // per-deployment URLs (Vercel), each row is an openable old version, which
  // makes this a version history without storing a single pixel.
  deploys: defineTable({
    projectId: v.id("projects"),
    at: v.number(),
    production: v.boolean(),
    environment: v.optional(v.string()),
    branch: v.string(),
    sha: v.optional(v.string()),
    url: v.string(),
  }).index("by_project", ["projectId", "at"]),

  deploymentSamples: defineTable({
    projectId: v.id("projects"),
    branch: v.string(),
    url: v.string(),
    environment: v.optional(v.string()),
    at: v.number(),
  }).index("by_project", ["projectId"]),

  frameSnapshots: defineTable({
    frameId: v.id("frames"),
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    capturedAt: v.number(),
  })
    .index("by_frame", ["frameId"])
    .index("by_project", ["projectId"]),

  // A frame on the canvas: a route of the code project or a Figma frame.
  frames: defineTable({
    projectId: v.id("projects"),
    // "state" (Flow v2): a screen in a particular condition — an error, an
    // empty state, a loading moment — rather than a route or a Figma node.
    kind: v.union(v.literal("route"), v.literal("figma"), v.literal("state")),
    title: v.string(),
    // IA grouping derived from route structure; drawn as a labeled region.
    section: v.optional(v.string()),
    // kind=route or state: URL path within the app (e.g. "/settings").
    routePath: v.optional(v.string()),
    // kind=figma: node id within the project's Figma file.
    figmaNodeId: v.optional(v.string()),
    // kind=state: the human-readable condition, e.g. "empty inbox".
    stateLabel: v.optional(v.string()),
    // kind=state: where it came from — a browser crawl or a person.
    stateOrigin: v.optional(v.union(v.literal("crawl"), v.literal("manual"))),
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
    // Absent = started by a guest from the web share page.
    createdBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_frame", ["frameId"]),

  messages: defineTable({
    threadId: v.id("threads"),
    // Absent = guest comment from the web share page (guestName set instead).
    authorId: v.optional(v.id("users")),
    guestName: v.optional(v.string()),
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
  })
    .index("by_user", ["userId"])
    // For project deletion's cascade: reach a thread's notifications directly.
    .index("by_thread", ["threadId"]),

  // Personal curation: a pinned project sorts first in its workspace section
  // on the pinner's home. One row per (user, project); unpin deletes it.
  projectPins: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
  })
    .index("by_user", ["userId"])
    .index("by_user_project", ["userId", "projectId"])
    // For project deletion's cascade: drop every user's pin of this project.
    .index("by_project", ["projectId"]),

  // Presence heartbeat per user per project. previousVisitAt marks when the
  // *prior* visit ended (set when a heartbeat lands after a >10min gap) —
  // the anchor for the "since you were last here" catch-up strip.
  presence: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    lastSeenAt: v.number(),
    previousVisitAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_user_project", ["userId", "projectId"]),

  // Crash/error reports from installed apps (POST /api/error). With builds
  // shipping over the air, this is how a bad release is noticed before a
  // teammate DMs "it's blank again". Surfaced in the Pilot pulse.
  appErrors: defineTable({
    version: v.string(),
    surface: v.union(v.literal("main"), v.literal("renderer"), v.literal("react")),
    message: v.string(),
    stack: v.optional(v.string()),
    email: v.optional(v.string()),
  }).index("by_version", ["version"]),

  // The web app (renderer bundle) served at /app for non-repo personas —
  // clients on Windows, PMs, anyone without the desktop install. Published
  // by scripts/publish-webapp.mjs; newest row wins.
  webApp: defineTable({
    indexHtml: v.string(),
    files: v.array(v.object({ name: v.string(), storageId: v.id("_storage") })),
    publishedAt: v.number(),
  }),

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
    // Visitor recruiting: when enabled, the site's intercept snippet invites
    // a sampled fraction of real visitors to take this test.
    intercept: v.optional(
      v.object({ enabled: v.boolean(), rate: v.number(), label: v.optional(v.string()) })
    ),
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
  // Flow v2: one browser-crawl run. The runToken is its write credential for
  // the proposal-ingest HTTP endpoint, exactly like a cloud agent's.
  flowCrawls: defineTable({
    projectId: v.id("projects"),
    runToken: v.string(),
    status: v.union(v.literal("starting"), v.literal("running"), v.literal("done"), v.literal("error")),
    found: v.number(),
    error: v.optional(v.string()),
  }).index("by_project", ["projectId"]),

  // Flow v2: the browser crawl stages its finds HERE, never in frames. Every
  // proposal is a real screenshot of a really-reached state; a human promotes
  // it to a frame + edge or rejects it. This is the "never invent" firewall —
  // the agent cannot put anything on the graph on its own.
  flowStateProposals: defineTable({
    projectId: v.id("projects"),
    // Screenshot of the reached state (Convex storage).
    storageId: v.id("_storage"),
    routePath: v.string(),
    stateLabel: v.string(),
    // How the crawl says it got here, shown to the reviewer as context.
    trigger: v.optional(v.string()),
    // The happy-path route frame this state hangs off, if the crawl matched one.
    fromRoutePath: v.optional(v.string()),
    // Dedup key (route + a signature of the rendered page) so the same state
    // isn't proposed twice within a crawl.
    signature: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    createdAt: v.number(),
  }).index("by_project", ["projectId"]),

  // Flow view (v1): a directed edge between two frames, earned from evidence.  // Flow view (v1): a directed edge between two frames, earned from evidence.
  // source records where an edge came from ("tests" = derived from recorded
  // tester navigation; "manual" reserved for hand-drawn edges later), so
  // provenance survives mixing and re-derivation can replace only its own.
  flowEdges: defineTable({
    projectId: v.id("projects"),
    fromFrameId: v.id("frames"),
    toFrameId: v.id("frames"),
    label: v.optional(v.string()),
    // tests: recorded tester sessions. manual: drawn by hand. code: declared
    // in the source (Link hrefs, router.push targets) — still evidence, never
    // invention, but evidence of intent rather than of observed behaviour.
    source: v.union(v.literal("tests"), v.literal("manual"), v.literal("code")),
    weight: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

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

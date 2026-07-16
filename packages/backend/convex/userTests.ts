import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { accessibleProject } from "./access";

/**
 * Maze-style usability tests. Team members build tests in Commons; testers run
 * them anonymously at /t/<token> (an HTTP action in http.ts serves the harness
 * page against the project's deployed preview). Raw route/click events stream
 * into testEvents; per-task summaries are computed in the harness and stored
 * on testSessions so results queries stay cheap.
 */

const taskValidator = v.object({
  id: v.string(),
  instruction: v.string(),
  targetRoute: v.optional(v.string()),
});

const questionValidator = v.object({
  id: v.string(),
  prompt: v.string(),
  kind: v.union(v.literal("scale"), v.literal("text")),
});

const taskResultValidator = v.object({
  taskId: v.string(),
  outcome: v.union(v.literal("success"), v.literal("gave_up")),
  auto: v.boolean(),
  durationMs: v.number(),
  routeSequence: v.array(v.string()),
  clickCount: v.number(),
  misclickCount: v.number(),
});

function randomToken(): string {
  // Math.random is deterministic-on-replay inside Convex mutations.
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join("");
}

// ---------------------------------------------------------------------------
// Team-facing API (userId-gated like every other project query)
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    title: v.string(),
    startRoute: v.string(),
    device: v.object({ width: v.number(), height: v.number() }),
    tasks: v.array(taskValidator),
    questions: v.array(questionValidator),
    variant: v.optional(v.object({ label: v.string(), url: v.string() })),
  },
  handler: async (ctx, args) => {
    const project = await accessibleProject(ctx, args.projectId, args.userId);
    if (!project) throw new Error("Project not found");
    if (!project.previewUrl) throw new Error("Set a preview URL first — testers open the deployed app.");
    const testId = await ctx.db.insert("tests", {
      projectId: args.projectId,
      createdBy: args.userId,
      title: args.title,
      token: randomToken(),
      reportToken: randomToken(),
      status: "live",
      startRoute: args.startRoute,
      device: args.device,
      tasks: args.tasks,
      questions: args.questions,
      variant: args.variant,
    });
    return testId;
  },
});

export const setStatus = mutation({
  args: {
    testId: v.id("tests"),
    userId: v.id("users"),
    status: v.union(v.literal("live"), v.literal("closed")),
  },
  handler: async (ctx, args) => {
    const test = await ctx.db.get(args.testId);
    if (!test) throw new Error("Test not found");
    if (!(await accessibleProject(ctx, test.projectId, args.userId))) throw new Error("Not allowed");
    await ctx.db.patch(args.testId, { status: args.status });
  },
});

export const forProject = query({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await accessibleProject(ctx, args.projectId, args.userId))) return [];
    const tests = await ctx.db
      .query("tests")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
    return Promise.all(
      tests.map(async (test) => {
        const sessions = await ctx.db
          .query("testSessions")
          .withIndex("by_test", (q) => q.eq("testId", test._id))
          .collect();
        return {
          ...test,
          sessionCount: sessions.length,
          completedCount: sessions.filter((s) => s.completedAt).length,
        };
      })
    );
  },
});

/** Full per-session results; aggregates are computed in the renderer. */
export const results = query({
  args: { testId: v.id("tests"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const test = await ctx.db.get(args.testId);
    if (!test) return null;
    if (!(await accessibleProject(ctx, test.projectId, args.userId))) return null;
    const sessions = await ctx.db
      .query("testSessions")
      .withIndex("by_test", (q) => q.eq("testId", args.testId))
      .collect();
    return { test, sessions };
  },
});

/** Every click of a test grouped by route — the canvas heatmap overlay. */
export const heatmap = query({
  args: { testId: v.id("tests"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const test = await ctx.db.get(args.testId);
    if (!test) return null;
    if (!(await accessibleProject(ctx, test.projectId, args.userId))) return null;
    const events = await ctx.db
      .query("testEvents")
      .withIndex("by_test", (q) => q.eq("testId", args.testId))
      .collect();
    const clicksByRoute: Record<string, { fx: number; fy: number; interactive: boolean }[]> = {};
    for (const event of events) {
      if (event.kind !== "click" || !event.route || event.fx === undefined || event.fy === undefined) continue;
      (clicksByRoute[event.route] ??= []).push({
        fx: event.fx,
        fy: event.fy,
        interactive: event.interactive ?? true,
      });
    }
    return { title: test.title, clicksByRoute };
  },
});

// ---------------------------------------------------------------------------
// Internal API for the HTTP tester harness (token-authenticated, anonymous)
// ---------------------------------------------------------------------------

export const pageData = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const test = await ctx.db
      .query("tests")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!test) return null;
    const project = await ctx.db.get(test.projectId);
    return { test, previewUrl: project?.previewUrl ?? null, projectName: project?.name ?? "" };
  },
});

export const startSession = internalMutation({
  args: { token: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const test = await ctx.db
      .query("tests")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!test || test.status !== "live") return null;
    // A/B assignment alternates by arrival order — even split at any n.
    let variant: "a" | "b" | undefined;
    if (test.variant) {
      const existing = await ctx.db
        .query("testSessions")
        .withIndex("by_test", (q) => q.eq("testId", test._id))
        .collect();
      variant = existing.length % 2 === 0 ? "a" : "b";
    }
    const sessionId = await ctx.db.insert("testSessions", {
      testId: test._id,
      startedAt: Date.now(),
      instrumented: false,
      userAgent: args.userAgent,
      variant,
      tasks: [],
    });
    return { sessionId, variant };
  },
});

export const recordEvents = internalMutation({
  args: {
    sessionId: v.id("testSessions"),
    events: v.array(
      v.object({
        taskId: v.optional(v.string()),
        kind: v.union(v.literal("route"), v.literal("click")),
        route: v.optional(v.string()),
        fx: v.optional(v.number()),
        fy: v.optional(v.number()),
        interactive: v.optional(v.boolean()),
        at: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.completedAt) return;
    // Events only ever originate from the in-app snippet, so any batch proves
    // the target app is instrumented.
    if (!session.instrumented && args.events.length > 0) {
      await ctx.db.patch(args.sessionId, { instrumented: true });
    }
    for (const event of args.events.slice(0, 200)) {
      await ctx.db.insert("testEvents", { sessionId: args.sessionId, testId: session.testId, ...event });
    }
  },
});

export const recordTask = internalMutation({
  args: { sessionId: v.id("testSessions"), task: taskResultValidator },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.completedAt) return;
    if (session.tasks.some((t) => t.taskId === args.task.taskId)) return;
    await ctx.db.patch(args.sessionId, { tasks: [...session.tasks, args.task] });
  },
});

export const finishSession = internalMutation({
  args: {
    sessionId: v.id("testSessions"),
    answers: v.array(v.object({ questionId: v.string(), value: v.string() })),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.completedAt) return;
    await ctx.db.patch(args.sessionId, { answers: args.answers, completedAt: Date.now() });
  },
});

/** Aggregate data for the shareable read-only report page (/r/<reportToken>). */
export const reportData = internalQuery({
  args: { reportToken: v.string() },
  handler: async (ctx, args) => {
    const test = await ctx.db
      .query("tests")
      .withIndex("by_report_token", (q) => q.eq("reportToken", args.reportToken))
      .unique();
    if (!test) return null;
    const project = await ctx.db.get(test.projectId);
    const sessions = await ctx.db
      .query("testSessions")
      .withIndex("by_test", (q) => q.eq("testId", test._id))
      .collect();
    return { test, sessions, projectName: project?.name ?? "" };
  },
});

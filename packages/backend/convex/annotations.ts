import { mutation, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { accessibleProject, resolveViewer } from "./access";

/**
 * Design Context Layer (NAR-1/2). Drafts are generated on the host's machine
 * (main-process annotator) and land here; the designer curates them in the
 * review queue; approved rows render on the canvas layer and the share page.
 * Every curation decision is logged to annotationEdits — the voice-profile
 * corpus (NAR-4) accrues from day one even though no learning ships yet.
 */

const citationValidator = v.object({
  kind: v.union(
    v.literal("commit"),
    v.literal("doc"),
    v.literal("code"),
    v.literal("thread"),
    v.literal("test")
  ),
  ref: v.string(),
  verified: v.optional(v.boolean()),
});

const viewerArgs = {
  userId: v.optional(v.id("users")),
  sessionToken: v.optional(v.string()),
};

async function requireProject(
  ctx: Parameters<typeof accessibleProject>[0],
  projectId: Id<"projects">,
  args: { userId?: Id<"users">; sessionToken?: string }
): Promise<{ project: Doc<"projects">; viewerId: Id<"users"> }> {
  const viewerId = await resolveViewer(ctx, args);
  const project = viewerId ? await accessibleProject(ctx, projectId, viewerId) : null;
  if (!project || !viewerId) throw new Error("You don't have access to this project.");
  return { project, viewerId };
}

/** All annotations for a project (team view: drafts + approved), plus the latest run. */
export const forProject = query({
  args: { projectId: v.id("projects"), ...viewerArgs },
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args);
    const annotations = await ctx.db
      .query("annotations")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(500);
    const runs = await ctx.db
      .query("annotationRuns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(1);
    return {
      annotations: annotations.filter((a) => a.status !== "rejected"),
      draftCount: annotations.filter((a) => a.status === "draft").length,
      latestRun: runs[0] ?? null,
    };
  },
});

/** Host starts a generation pass. One running pass per project at a time. */
export const startRun = mutation({
  args: { projectId: v.id("projects"), ...viewerArgs },
  handler: async (ctx, args) => {
    const { viewerId } = await requireProject(ctx, args.projectId, args);
    const existing = await ctx.db
      .query("annotationRuns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(1);
    if (existing[0]?.status === "running") {
      throw new Error("An annotation pass is already running for this project.");
    }
    return await ctx.db.insert("annotationRuns", {
      projectId: args.projectId,
      userId: viewerId,
      status: "running",
    });
  },
});

/**
 * Host lands a finished pass: drafts in one transaction, so the review queue
 * never sees a half-written batch. Frame titles from the generator are matched
 * to frame ids here (the generator works from routes/titles, not Convex ids).
 */
export const finishRun = mutation({
  args: {
    runId: v.id("annotationRuns"),
    confidenceNotes: v.optional(v.string()),
    error: v.optional(v.string()),
    drafts: v.array(
      v.object({
        frameTitle: v.optional(v.string()),
        flowTitle: v.optional(v.string()),
        text: v.string(),
        citations: v.array(citationValidator),
      })
    ),
    ...viewerArgs,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Annotation run not found.");
    const { viewerId } = await requireProject(ctx, run.projectId, args);
    if (run.userId !== viewerId) throw new Error("Only the run's host can finish it.");
    if (args.error) {
      await ctx.db.patch(args.runId, { status: "error", error: args.error });
      return null;
    }
    const frames = await ctx.db
      .query("frames")
      .withIndex("by_project", (q) => q.eq("projectId", run.projectId))
      .take(200);
    const byTitle = new Map(frames.map((f) => [f.title.toLowerCase(), f._id]));
    let order = 0;
    for (const draft of args.drafts) {
      const frameId = draft.frameTitle ? byTitle.get(draft.frameTitle.toLowerCase()) : undefined;
      // A screen draft whose frame no longer exists still lands, as flow-level
      // under the screen's name — never silently dropped.
      await ctx.db.insert("annotations", {
        projectId: run.projectId,
        frameId,
        flowTitle: frameId ? draft.flowTitle : (draft.flowTitle ?? draft.frameTitle),
        text: draft.text,
        citations: draft.citations,
        status: "draft",
        runId: args.runId,
        order: order++,
      });
    }
    await ctx.db.patch(args.runId, {
      status: "done",
      confidenceNotes: args.confidenceNotes,
      draftCount: args.drafts.length,
    });
    return null;
  },
});

/**
 * One curation decision. "edit" implies approval of the edited text — the
 * queue's actions are approve / edit-and-approve / reject. Every decision
 * writes the before/after pair to annotationEdits.
 */
export const curate = mutation({
  args: {
    annotationId: v.id("annotations"),
    action: v.union(v.literal("approve"), v.literal("edit"), v.literal("reject")),
    text: v.optional(v.string()),
    reason: v.optional(v.string()),
    ...viewerArgs,
  },
  handler: async (ctx, args) => {
    const annotation = await ctx.db.get(args.annotationId);
    if (!annotation) throw new Error("Annotation not found.");
    const { viewerId } = await requireProject(ctx, annotation.projectId, args);
    const after = args.action === "reject" ? "" : (args.text ?? annotation.text);
    if (args.action === "edit" && !args.text?.trim()) throw new Error("Edited text is empty.");
    await ctx.db.insert("annotationEdits", {
      annotationId: annotation._id,
      projectId: annotation.projectId,
      userId: viewerId,
      action: args.action,
      before: annotation.text,
      after,
      reason: args.reason,
    });
    await ctx.db.patch(annotation._id, {
      status: args.action === "reject" ? "rejected" : "approved",
      text: args.action === "reject" ? annotation.text : after,
      curatorId: viewerId,
      curatedAt: Date.now(),
    });
    return null;
  },
});

/** Unpublish an approved annotation (back to draft for re-curation). */
export const unapprove = mutation({
  args: { annotationId: v.id("annotations"), ...viewerArgs },
  handler: async (ctx, args) => {
    const annotation = await ctx.db.get(args.annotationId);
    if (!annotation) throw new Error("Annotation not found.");
    await requireProject(ctx, annotation.projectId, args);
    await ctx.db.patch(annotation._id, { status: "draft" });
    return null;
  },
});

/** Approved annotations for the web share page (token-gated by the caller). */
export const forSharePage = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const annotations = await ctx.db
      .query("annotations")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "approved"))
      .take(500);
    return annotations.map((a) => ({
      frameId: a.frameId ?? null,
      flowTitle: a.flowTitle ?? null,
      text: a.text,
      citations: a.citations.map((c) => ({ kind: c.kind, ref: c.ref, verified: c.verified ?? false })),
      order: a.order,
    }));
  },
});

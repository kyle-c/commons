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

/**
 * What this team's curation has taught us about their voice.
 *
 * annotationEdits has been recording every approve / edit / reject since
 * Narrate shipped, and nothing read it — the corpus accumulated while each run
 * started from the same cold prompt. These rows are the highest-signal thing
 * available about how this particular team writes: an edit is a correction in
 * their own words, a reject is a whole category they don't want.
 *
 * Returned newest-first and capped, because this becomes prompt context and
 * the point is a few sharp examples, not an archive.
 */
export const voiceCorpus = query({
  args: { projectId: v.id("projects"), ...viewerArgs },
  handler: async (ctx, args) => {
    // Degrades rather than throws: this is prompt seasoning, and a query that
    // throws takes the whole panel down with it through the error boundary —
    // the failure that white-screened v0.2.68. Nothing here is essential
    // enough to be worth that, and no access means no rows either way.
    const viewerId = await resolveViewer(ctx, args);
    const project = viewerId ? await accessibleProject(ctx, args.projectId, viewerId) : null;
    if (!project) return [];
    const rows = await ctx.db
      .query("annotationEdits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(120);

    const trim = (text: string) => (text.length > 400 ? `${text.slice(0, 400)}…` : text);
    const edits = rows
      .filter((r) => r.action === "edit" && r.after.trim() && r.after !== r.before)
      .slice(0, 12)
      .map((r) => ({ action: "edit" as const, before: trim(r.before), after: trim(r.after), reason: r.reason }));
    const rejects = rows
      .filter((r) => r.action === "reject")
      .slice(0, 6)
      .map((r) => ({ action: "reject" as const, before: trim(r.before), after: "", reason: r.reason }));
    // Approved untouched: the shape that already works, worth keeping in view
    // so the model isn't only shown its mistakes.
    const kept = rows
      .filter((r) => r.action === "approve" && r.before === r.after)
      .slice(0, 6)
      .map((r) => ({ action: "approve" as const, before: trim(r.before), after: trim(r.after), reason: undefined }));

    return [...edits, ...rejects, ...kept];
  },
});

/** All annotations for a project (team view: drafts + approved), plus the latest run. */
export const forProject = query({
  args: { projectId: v.id("projects"), ...viewerArgs },
  handler: async (ctx, args) => {
    // See voiceCorpus: rendered queries degrade, they don't throw.
    const viewerId = await resolveViewer(ctx, args);
    if (!viewerId || !(await accessibleProject(ctx, args.projectId, viewerId))) {
      return { annotations: [], draftCount: 0, latestRun: null };
    }
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

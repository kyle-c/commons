import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { accessibleProject, resolveViewer } from "./access";
import { isMember } from "./workspaces";

/**
 * The Figma bridge, first slice (CAN-6): Figma frames on the shared canvas.
 *
 * A frame with kind "figma" renders exactly like a code frame whose dev
 * server is down: through its snapshot. So the whole bridge reduces to
 * filling frameSnapshots from Figma's render API instead of from a headless
 * browser, and every canvas behavior (pan, zoom, pins, threads, guest mode,
 * the Notes layer) works on Figma frames without knowing they are Figma.
 *
 * Scope discipline: this is import-and-render only. Figma-to-code and the
 * companion write-back plugin (the rest of M4) stay unbuilt until the pilot
 * pulls for them; the PRD says the same.
 *
 * The token is a workspace credential pasted by a member, same trust posture
 * as the Slack webhook beside it in the schema. Commons only ever calls read
 * endpoints with it.
 */

/** file key + node id out of a Figma frame URL, or null. */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string } | null {
  const match = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)[^?]*\?(?:.*&)?node-id=([0-9]+[-:][0-9]+)/);
  if (!match) return null;
  // The URL spells "12-34"; the API wants "12:34".
  return { fileKey: match[1], nodeId: match[2].replace("-", ":") };
}

export const setToken = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    sessionToken: v.optional(v.string()),
    figmaToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveViewer(ctx, args);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace || !userId || !(await isMember(ctx, workspace._id, userId))) {
      throw new Error("You're not a member of this workspace.");
    }
    await ctx.db.patch(args.workspaceId, { figmaToken: args.figmaToken || undefined });
  },
});

/**
 * Paste a Figma frame URL, get a frame on the canvas. The snapshot arrives a
 * beat later from the render action; until then the frame shows the same
 * "no preview yet" state a route frame shows before its first capture.
 */
export const addFrame = mutation({
  args: {
    projectId: v.id("projects"),
    figmaUrl: v.string(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = viewerId ? await accessibleProject(ctx, args.projectId, viewerId) : null;
    if (!project) throw new Error("You don't have access to this project.");
    const parsed = parseFigmaUrl(args.figmaUrl.trim());
    if (!parsed) {
      throw new Error("That doesn't look like a Figma frame link. Copy it via Figma's Share → Copy link on a frame.");
    }
    if (!project.workspaceId) throw new Error("Figma frames need the project in a workspace (the token lives there).");
    const workspace = await ctx.db.get(project.workspaceId);
    if (!workspace?.figmaToken) {
      throw new Error("Connect Figma first: paste a personal access token in this workspace's Figma setting.");
    }

    if (!project.figmaFileKey) await ctx.db.patch(project._id, { figmaFileKey: parsed.fileKey });

    const siblings = await ctx.db
      .query("frames")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const frameId = await ctx.db.insert("frames", {
      projectId: args.projectId,
      kind: "figma",
      title: "Figma frame",
      figmaNodeId: parsed.nodeId,
      section: "Figma",
      x: 120 + (siblings.length % 6) * 60,
      y: 120 + siblings.length * 40,
      width: 800,
      height: 600,
    });
    await ctx.scheduler.runAfter(0, internal.figma.renderFrame, { frameId, fileKey: parsed.fileKey });
    return frameId;
  },
});

/** Re-fetch the render, e.g. after the design changed in Figma. */
export const refreshFrame = mutation({
  args: {
    frameId: v.id("frames"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const frame = await ctx.db.get(args.frameId);
    const project = frame && viewerId ? await accessibleProject(ctx, frame.projectId, viewerId) : null;
    if (!project || !frame || frame.kind !== "figma") throw new Error("Not a Figma frame you can refresh.");
    if (!project.figmaFileKey) throw new Error("This project has no Figma file recorded.");
    await ctx.scheduler.runAfter(0, internal.figma.renderFrame, {
      frameId: args.frameId,
      fileKey: project.figmaFileKey,
    });
  },
});

/** Whether this project's workspace has Figma connected. Rendered; degrades. */
export const status = query({
  args: {
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = viewerId ? await accessibleProject(ctx, args.projectId, viewerId) : null;
    if (!project?.workspaceId) return { connected: false, workspaceId: null };
    const workspace = await ctx.db.get(project.workspaceId);
    return { connected: Boolean(workspace?.figmaToken), workspaceId: project.workspaceId };
  },
});

export const renderContext = internalQuery({
  args: { frameId: v.id("frames") },
  handler: async (ctx, { frameId }) => {
    const frame = await ctx.db.get(frameId);
    if (!frame || frame.kind !== "figma" || !frame.figmaNodeId) return null;
    const project = await ctx.db.get(frame.projectId);
    if (!project?.workspaceId) return null;
    const workspace = await ctx.db.get(project.workspaceId);
    if (!workspace?.figmaToken) return null;
    return { nodeId: frame.figmaNodeId, token: workspace.figmaToken, projectId: frame.projectId };
  },
});

/**
 * Fetch the node's render (and its real name and size) from Figma, store the
 * PNG, and upsert the frame's snapshot. Scale 2 so zooming in on the canvas
 * stays crisp; the node's own dimensions become the frame's, because a Figma
 * frame lies about nothing so much as a wrong aspect ratio.
 */
export const renderFrame = internalAction({
  args: { frameId: v.id("frames"), fileKey: v.string() },
  handler: async (ctx, { frameId, fileKey }) => {
    const context = await ctx.runQuery(internal.figma.renderContext, { frameId });
    if (!context) return null;
    const headers = { "X-Figma-Token": context.token };

    try {
      const meta = await fetch(
        `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(context.nodeId)}`,
        { headers }
      );
      let title: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      if (meta.ok) {
        const body = (await meta.json()) as {
          nodes?: Record<string, { document?: { name?: string; absoluteBoundingBox?: { width: number; height: number } } }>;
        };
        const node = body.nodes?.[context.nodeId]?.document;
        title = node?.name;
        if (node?.absoluteBoundingBox) {
          width = Math.round(node.absoluteBoundingBox.width);
          height = Math.round(node.absoluteBoundingBox.height);
        }
      }

      const render = await fetch(
        `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(context.nodeId)}&format=png&scale=2`,
        { headers }
      );
      if (!render.ok) {
        throw new Error(`Figma answered ${render.status} — the token may lack access to this file.`);
      }
      const body = (await render.json()) as { images?: Record<string, string | null> };
      const imageUrl = body.images?.[context.nodeId];
      if (!imageUrl) throw new Error("Figma returned no render for this node.");
      const image = await fetch(imageUrl);
      if (!image.ok) throw new Error(`The render URL answered ${image.status}.`);
      const storageId = await ctx.storage.store(await image.blob());

      await ctx.runMutation(internal.figma.recordRender, {
        frameId,
        projectId: context.projectId,
        storageId,
        title,
        width,
        height,
      });
    } catch (error) {
      await ctx.runMutation(internal.figma.recordRenderFailure, {
        frameId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  },
});

export const recordRender = internalMutation({
  args: {
    frameId: v.id("frames"),
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    title: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const frame = await ctx.db.get(args.frameId);
    if (!frame) return null;
    const patch: Record<string, unknown> = {};
    if (args.title && frame.title === "Figma frame") patch.title = args.title;
    if (args.width && args.height) {
      patch.width = args.width;
      patch.height = args.height;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(args.frameId, patch);

    const existing = await ctx.db
      .query("frameSnapshots")
      .withIndex("by_frame", (q) => q.eq("frameId", args.frameId))
      .unique();
    if (existing) {
      await ctx.storage.delete(existing.storageId);
      await ctx.db.patch(existing._id, { storageId: args.storageId, capturedAt: Date.now() });
    } else {
      await ctx.db.insert("frameSnapshots", {
        frameId: args.frameId,
        projectId: args.projectId,
        storageId: args.storageId,
        capturedAt: Date.now(),
      });
    }
    return null;
  },
});

/** A failed render retitles the frame with the reason, so it isn't silent. */
export const recordRenderFailure = internalMutation({
  args: { frameId: v.id("frames"), detail: v.string() },
  handler: async (ctx, { frameId, detail }) => {
    const frame = await ctx.db.get(frameId);
    if (frame && frame.kind === "figma") {
      await ctx.db.patch(frameId, { title: `Figma render failed: ${detail.slice(0, 80)}` });
    }
    return null;
  },
});

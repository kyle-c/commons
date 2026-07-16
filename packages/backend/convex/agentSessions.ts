import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { accessibleProject } from "./access";

// Agent sessions execute on the host's machine (Electron main process); the
// host mirrors every AgentSessionEvent here so the whole team can watch live.

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    hostUserId: v.id("users"),
    adapter: v.string(),
    title: v.string(),
    threadId: v.optional(v.id("threads")),
    frameId: v.optional(v.id("frames")),
    routePath: v.optional(v.string()),
  },
  handler: (ctx, args) => ctx.db.insert("agentSessions", { ...args, status: "starting", editedFiles: [] }),
});

// Append one transcript event. Status and result events also fold their
// payload into the session document so lists stay live without reading events.
export const appendEvent = mutation({
  args: { sessionId: v.id("agentSessions"), event: v.any() },
  handler: async (ctx, { sessionId, event }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return;
    await ctx.db.insert("agentEvents", { sessionId, event });
    if (event.type === "status") {
      await ctx.db.patch(sessionId, { status: event.status, error: event.error });
    } else if (event.type === "result" && Array.isArray(event.editedFiles)) {
      await ctx.db.patch(sessionId, { editedFiles: event.editedFiles });
    }
  },
});

// Sessions for a project, newest first, with the host teammate joined in.
export const forProject = query({
  args: { projectId: v.id("projects"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { projectId, userId }) => {
    if (!(await accessibleProject(ctx, projectId, userId))) return [];
    const sessions = await ctx.db
      .query("agentSessions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    sessions.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(sessions.map(async (s) => ({ ...s, host: await ctx.db.get(s.hostUserId) })));
  },
});

// Sessions die with the host's app, but a crash/quit can't update the mirror.
// Called on host launch with the sessions actually alive in its main process;
// anything else still marked active is finalized as stopped.
export const reconcileHost = mutation({
  args: { hostUserId: v.id("users"), activeMirrorIds: v.array(v.id("agentSessions")) },
  handler: async (ctx, { hostUserId, activeMirrorIds }) => {
    const alive = new Set(activeMirrorIds);
    const sessions = await ctx.db
      .query("agentSessions")
      .withIndex("by_host", (q) => q.eq("hostUserId", hostUserId))
      .collect();
    for (const session of sessions) {
      if (alive.has(session._id)) continue;
      if (session.status !== "starting" && session.status !== "running") continue;
      await ctx.db.patch(session._id, { status: "stopped", error: "Host went offline mid-session." });
      await ctx.db.insert("agentEvents", {
        sessionId: session._id,
        event: { type: "status", status: "stopped", error: "Host went offline mid-session." },
      });
    }
  },
});

// Full ordered transcript of one session.
export const events = query({
  args: { sessionId: v.id("agentSessions"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { sessionId, userId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || !(await accessibleProject(ctx, session.projectId, userId))) return [];
    const rows = await ctx.db
      .query("agentEvents")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return rows.map((row) => row.event);
  },
});

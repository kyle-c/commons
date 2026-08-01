import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { accessibleProject, requireProjectAccess, requireViewer, resolveViewer } from "./access";

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
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { sessionToken, ...session }) => {
    await requireProjectAccess(ctx, session.projectId, { userId: session.hostUserId, sessionToken });
    return await ctx.db.insert("agentSessions", { ...session, status: "starting", editedFiles: [] });
  },
});

// Append one transcript event. Status and result events also fold their
// payload into the session document so lists stay live without reading events.
export const appendEvent = mutation({
  args: {
    sessionId: v.id("agentSessions"),
    event: v.any(),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, event, ...viewer }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return;
    // Agent transcripts land in threads and on the canvas, so only someone
    // who can see the project may append to one.
    await requireProjectAccess(ctx, session.projectId, viewer);
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
  args: { projectId: v.id("projects"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { projectId, ...viewer }) => {
    if (!(await accessibleProject(ctx, projectId, await resolveViewer(ctx, viewer)))) return [];
    const sessions = await ctx.db
      .query("agentSessions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    sessions.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(
      sessions.map(async (s) => {
        // runToken is the cloud runner's write credential; it must never
        // reach a client, member or not.
        const { runToken: _stripped, ...safe } = s;
        return { ...safe, host: await ctx.db.get(s.hostUserId) };
      })
    );
  },
});

// Sessions die with the host's app, but a crash/quit can't update the mirror.
// Called on host launch with the sessions actually alive in its main process;
// anything else still marked active is finalized as stopped.
export const reconcileHost = mutation({
  args: {
    hostUserId: v.id("users"),
    activeMirrorIds: v.array(v.id("agentSessions")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { activeMirrorIds, hostUserId, sessionToken }) => {
    // Only a host reconciles its own sessions.
    const viewerId = await requireViewer(ctx, { userId: hostUserId, sessionToken });
    const alive = new Set(activeMirrorIds);
    const sessions = await ctx.db
      .query("agentSessions")
      .withIndex("by_host", (q) => q.eq("hostUserId", viewerId))
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
  args: { sessionId: v.id("agentSessions"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { sessionId, ...viewer }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || !(await accessibleProject(ctx, session.projectId, await resolveViewer(ctx, viewer)))) return [];
    const rows = await ctx.db
      .query("agentEvents")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return rows.map((row) => row.event);
  },
});

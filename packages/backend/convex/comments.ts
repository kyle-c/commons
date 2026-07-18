import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildDeepLink } from "@commons/shared";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { accessibleProject, canAccessProject, filterMentions, resolveViewer } from "./access";

// @mentions notify twice: an inbox row (inserted by the caller) and an email,
// sent from an action so a slow/failed Resend call never blocks the mutation.
async function scheduleMentionEmails(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    threadId: Id<"threads">;
    authorId: Id<"users">;
    body: string;
    mentions: Id<"users">[];
  }
): Promise<void> {
  if (args.mentions.length === 0) return;
  const [author, project] = await Promise.all([ctx.db.get(args.authorId), ctx.db.get(args.projectId)]);
  const mentioned = await Promise.all(args.mentions.map((id) => ctx.db.get(id)));
  const recipients = mentioned
    .filter((u) => u !== null)
    .map((u) => ({ email: u.email, name: u.name }));
  if (recipients.length === 0) return;
  await ctx.scheduler.runAfter(0, internal.emails.sendMentionEmail, {
    recipients,
    authorName: author?.name ?? "A teammate",
    projectName: project?.name ?? "a project",
    snippet: args.body.length > 280 ? `${args.body.slice(0, 280)}…` : args.body,
    deepLink: buildDeepLink({ projectId: args.projectId, view: "canvas", threadId: args.threadId }),
  });
}

/** COM-6: new threads and agent results land in the project's workspace Slack channel. */
async function scheduleSlackPost(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; threadId: Id<"threads">; authorId: Id<"users">; body: string; kind: "thread" | "agent" }
): Promise<void> {
  const [author, project] = await Promise.all([ctx.db.get(args.authorId), ctx.db.get(args.projectId)]);
  // Private-project activity stays out of shared channels.
  if (!project || project.visibility === "private") return;
  // Workspace routing: each team workspace has its own webhook (personal
  // workspaces never post — a playground has an audience of one). Projects
  // not yet in a workspace fall back to the deployment-wide env webhook.
  let webhookUrl: string | undefined;
  if (project.workspaceId) {
    const workspace = await ctx.db.get(project.workspaceId);
    if (!workspace || workspace.kind === "personal") return;
    webhookUrl = workspace.slackWebhookUrl;
    if (!webhookUrl) return; // team workspace without a channel configured
  }
  const snippet = args.body.length > 200 ? `${args.body.slice(0, 200)}…` : args.body;
  const link = buildDeepLink({ projectId: args.projectId, view: "canvas", threadId: args.threadId });
  const headline =
    args.kind === "agent"
      ? `⚡ Agent draft ready on *${project.name}* (via ${author?.name ?? "a teammate"})`
      : `💬 ${author?.name ?? "A teammate"} started a thread on *${project.name}*`;
  await ctx.scheduler.runAfter(0, internal.slack.post, {
    text: `${headline}\n> ${snippet.replace(/\n/g, "\n> ")}\nOpen in Commons: ${link}`,
    webhookUrl,
  });
}

export const createThread = mutation({
  args: {
    projectId: v.id("projects"),
    createdBy: v.id("users"),
    body: v.string(),
    mentions: v.array(v.id("users")),
    frameId: v.optional(v.id("frames")),
    fx: v.optional(v.number()),
    fy: v.optional(v.number()),
    canvasX: v.optional(v.number()),
    canvasY: v.optional(v.number()),
  },
  handler: async (ctx, { body, mentions: rawMentions, ...thread }) => {
    const project = await ctx.db.get(thread.projectId);
    if (!project || !(await canAccessProject(ctx, project, thread.createdBy))) {
      throw new Error("You don't have access to this project.");
    }
    // Private projects: mentions of non-members are dropped, never notified.
    const mentions = await filterMentions(ctx, project, rawMentions);
    const threadId = await ctx.db.insert("threads", thread);
    const messageId = await ctx.db.insert("messages", {
      threadId,
      authorId: thread.createdBy,
      body,
      mentions,
    });
    for (const userId of mentions) {
      await ctx.db.insert("notifications", { userId, threadId, messageId });
    }
    await scheduleMentionEmails(ctx, {
      projectId: thread.projectId,
      threadId,
      authorId: thread.createdBy,
      body,
      mentions,
    });
    await scheduleSlackPost(ctx, {
      projectId: thread.projectId,
      threadId,
      authorId: thread.createdBy,
      body,
      kind: "thread",
    });
    return threadId;
  },
});

// Upload target for message-image attachments (snapshots).
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

// The first-class author for agent replies (open question 3): summaries no
// longer impersonate whoever hosted the session. Invisible in team/mention
// lists (it belongs to no workspace); created on first use.
const AGENT_EMAIL = "agent@commons.internal";
async function ensureAgentUser(ctx: MutationCtx): Promise<Id<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", AGENT_EMAIL))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("users", {
    name: "Commons Agent",
    email: AGENT_EMAIL,
    avatarColor: "#7c9cf5",
    lastSeenAt: 0,
  });
}

/** Agent results post under the agent identity, with the host attributed in-line. */
export const postAgentReply = mutation({
  args: {
    threadId: v.id("threads"),
    hostUserId: v.id("users"),
    sessionToken: v.optional(v.string()),
    body: v.string(),
    images: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    const hostId = (await resolveViewer(ctx, args)) ?? args.hostUserId;
    const thread = await ctx.db.get(args.threadId);
    const project = thread ? await ctx.db.get(thread.projectId) : null;
    if (!thread || !project || !(await canAccessProject(ctx, project, hostId))) {
      throw new Error("You don't have access to this project.");
    }
    const host = await ctx.db.get(hostId);
    const agentId = await ensureAgentUser(ctx);
    const body = `${args.body}\n\n— via ${host?.name ?? "a teammate"}'s machine`;
    await ctx.db.insert("messages", {
      threadId: args.threadId,
      authorId: agentId,
      body,
      mentions: [],
      images: args.images,
    });
    if (args.body.startsWith("⚡")) {
      await scheduleSlackPost(ctx, {
        projectId: thread.projectId,
        threadId: args.threadId,
        authorId: hostId, // Slack keeps the human attribution
        body: args.body,
        kind: "agent",
      });
    }
  },
});

export const reply = mutation({
  args: {
    threadId: v.id("threads"),
    authorId: v.id("users"),
    body: v.string(),
    mentions: v.array(v.id("users")),
    images: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const project = thread ? await ctx.db.get(thread.projectId) : null;
    if (!thread || !project || !(await canAccessProject(ctx, project, args.authorId))) {
      throw new Error("You don't have access to this project.");
    }
    const mentions = await filterMentions(ctx, project, args.mentions);
    const messageId = await ctx.db.insert("messages", { ...args, mentions });
    for (const userId of mentions) {
      await ctx.db.insert("notifications", {
        userId,
        threadId: args.threadId,
        messageId,
      });
    }
    await scheduleMentionEmails(ctx, {
      projectId: thread.projectId,
      threadId: args.threadId,
      authorId: args.authorId,
      body: args.body,
      mentions,
    });
    // Agent-result replies (AG-8 posts them with the ⚡ prefix) hit Slack too.
    if (args.body.startsWith("⚡")) {
      await scheduleSlackPost(ctx, {
        projectId: thread.projectId,
        threadId: args.threadId,
        authorId: args.authorId,
        body: args.body,
        kind: "agent",
      });
    }
    return messageId;
  },
});

export const setResolved = mutation({
  args: { threadId: v.id("threads"), resolved: v.boolean() },
  handler: async (ctx, { threadId, resolved }) => {
    await ctx.db.patch(threadId, { resolvedAt: resolved ? Date.now() : undefined });
  },
});

// All threads for a project, each with its messages and author details.
export const threadsForProject = query({
  args: { projectId: v.id("projects"), userId: v.optional(v.id("users")), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { projectId, ...viewer }) => {
    if (!(await accessibleProject(ctx, projectId, await resolveViewer(ctx, viewer)))) return [];
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return await Promise.all(
      threads.map(async (thread) => {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .collect();
        const withAuthors = await Promise.all(
          messages.map(async (m) => ({
            ...m,
            author: await ctx.db.get(m.authorId),
            imageUrls:
              m.images && m.images.length > 0
                ? (await Promise.all(m.images.map((id) => ctx.storage.getUrl(id)))).filter(
                    (u): u is string => u !== null
                  )
                : undefined,
          }))
        );
        return { ...thread, messages: withAuthors };
      })
    );
  },
});

export const inbox = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const items = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    return await Promise.all(
      items.map(async (n) => {
        const message = await ctx.db.get(n.messageId);
        const thread = await ctx.db.get(n.threadId);
        const author = message ? await ctx.db.get(message.authorId) : null;
        const project = thread ? await ctx.db.get(thread.projectId) : null;
        return { ...n, message, thread, author, project };
      })
    );
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    await ctx.db.patch(notificationId, { readAt: Date.now() });
  },
});

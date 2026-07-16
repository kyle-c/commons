import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Two layers of access control:
 *
 * 1. Viewer resolution — resolveViewer prefers the sessionToken (server-side
 *    proof of identity) over the bare userId argument. The userId fallback
 *    exists only for already-shipped clients (≤ v0.2.0) and can be removed
 *    once they age out via auto-update.
 * 2. Project access — you must be a member of the project's workspace; the
 *    "private" visibility refines further to explicit memberIds within it.
 */

export async function resolveViewer(
  ctx: QueryCtx,
  args: { sessionToken?: string; userId?: Id<"users"> }
): Promise<Id<"users"> | undefined> {
  if (args.sessionToken) {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.sessionToken!))
      .unique();
    return session?.userId; // an invalid token never falls back to the claimed id
  }
  return args.userId;
}

export async function canAccessProject(
  ctx: QueryCtx,
  project: Doc<"projects">,
  userId: Id<"users"> | undefined
): Promise<boolean> {
  // Workspace gate. Legacy rows (no workspace yet) fail closed to the creator
  // — migrateLegacy assigns them, so this is a transient state.
  if (project.workspaceId) {
    if (!userId) return false;
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user_workspace", (q) => q.eq("userId", userId).eq("workspaceId", project.workspaceId!))
      .unique();
    if (!membership) return false;
  } else if (project.createdBy !== userId) {
    return false;
  }
  if (!project.visibility || project.visibility === "team") return true;
  if (!userId) return false;
  return project.createdBy === userId || (project.memberIds ?? []).includes(userId);
}

/** The project if it exists and the user may see it, else null. */
export async function accessibleProject(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  userId: Id<"users"> | undefined
): Promise<Doc<"projects"> | null> {
  const project = await ctx.db.get(projectId);
  return project && (await canAccessProject(ctx, project, userId)) ? project : null;
}

/** Mentions of anyone who can't see the project are silently dropped. */
export async function filterMentions(
  ctx: QueryCtx,
  project: Doc<"projects">,
  mentions: Id<"users">[]
): Promise<Id<"users">[]> {
  const allowed = await Promise.all(mentions.map((id) => canAccessProject(ctx, project, id)));
  return mentions.filter((_, i) => allowed[i]);
}

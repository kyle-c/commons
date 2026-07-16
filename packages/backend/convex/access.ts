import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Project visibility. Absent visibility = "team" (everyone). Private projects
 * are visible to the creator plus explicitly added memberIds. `userId` is
 * optional so pre-privacy clients (which never send it) keep working — they
 * simply can't see private projects.
 */
export function canAccessProject(project: Doc<"projects">, userId: Id<"users"> | undefined): boolean {
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
  return project && canAccessProject(project, userId) ? project : null;
}

/** On private projects, mentions of non-members are silently dropped. */
export function filterMentions(project: Doc<"projects">, mentions: Id<"users">[]): Id<"users">[] {
  if (!project.visibility || project.visibility === "team") return mentions;
  return mentions.filter((id) => canAccessProject(project, id));
}

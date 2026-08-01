import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Two layers of access control:
 *
 * 1. Viewer resolution — identity comes from the sessionToken and nowhere
 *    else. A `userId` argument is a claim anyone can make: Convex publishes
 *    every non-internal function to the open internet, so honouring it made
 *    each per-function check bypassable by simply omitting the token. The
 *    legacy fallback that allowed it (for ≤ v0.2.0 clients) is gone; those
 *    clients aged out via auto-update long before v0.2.69.
 *
 *    Callers still pass `userId` — it stays in the signatures so shipped
 *    clients keep type-checking — but it is now inert for authorization.
 * 2. Project access — you must be a member of the project's workspace; the
 *    "private" visibility refines further to explicit memberIds within it.
 */

export async function resolveViewer(
  ctx: QueryCtx,
  args: { sessionToken?: string; userId?: Id<"users"> }
): Promise<Id<"users"> | undefined> {
  if (!args.sessionToken) return undefined;
  // first(), not unique(): a duplicated token row must never brick access.
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", args.sessionToken!))
    .first();
  return session?.userId; // an invalid token never falls back to the claimed id
}

/**
 * Identity or nothing.
 *
 * Convex publishes every non-internal function to the open internet, so a
 * function without this is callable by anyone who knows a document id — and
 * ids are not secret, they ride in deep links and Slack posts. A `userId`
 * argument is a *claim*; only the session token is proof.
 */
export async function requireViewer(
  ctx: QueryCtx,
  args: { sessionToken?: string; userId?: Id<"users"> }
): Promise<Id<"users">> {
  const userId = await resolveViewer(ctx, args);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

/** The project, or a thrown error — for mutations that must not touch a project you can't see. */
export async function requireProjectAccess(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  args: { sessionToken?: string; userId?: Id<"users"> }
): Promise<Doc<"projects">> {
  const project = await accessibleProject(ctx, projectId, await requireViewer(ctx, args));
  if (!project) throw new Error("Not allowed");
  return project;
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

/**
 * A cryptographically random hex token. The one place bearer secrets are
 * minted, so nobody re-derives it wrong.
 *
 * Convex mutations replay deterministically, which once prompted a belief
 * that Math.random was "fine here" — but Math.random is a non-crypto PRNG
 * whose stream an attacker can reconstruct from a few outputs, and these
 * tokens ARE the credential (share links, tester harnesses, connect flows).
 * crypto.getRandomValues is seeded per execution by the Convex runtime and
 * works in mutations (auth.ts has minted session tokens this way all along).
 */
export function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Workspace membership — the one implementation. `isMember` (workspaces.ts)
 * and a former local copy in github.ts both were this exact query; they now
 * route here so "member of a workspace" means one thing in one place.
 */
export async function isWorkspaceMember(
  ctx: { db: QueryCtx["db"] },
  workspaceId: Id<"workspaces">,
  userId: Id<"users">
): Promise<boolean> {
  const row = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user_workspace", (q) => q.eq("userId", userId).eq("workspaceId", workspaceId))
    .unique();
  return row !== null;
}

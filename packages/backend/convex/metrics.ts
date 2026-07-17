import { query } from "./_generated/server";
import { v } from "convex/values";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Pilot dashboard (MET-1): the §3 PRD measures, derived entirely from tables
 * Commons already writes — no client-side tracking. Full-table scans are fine
 * at pilot scale (~10 users); revisit if the team outgrows it.
 *
 * Also runnable headless: `npx convex run metrics:pilot '{}'`.
 */
export const pilot = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - WEEK;
    const priorWeekAgo = now - 2 * WEEK;

    const [users, threads, messages, agentEvents, testSessions, appErrors] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("threads").collect(),
      ctx.db.query("messages").collect(),
      ctx.db.query("agentEvents").collect(),
      ctx.db.query("testSessions").collect(),
      ctx.db.query("appErrors").collect(),
    ]);

    // Feedback→fix cycle: thread created → "⚡ Agent finished" reply lands.
    const threadCreated = new Map(threads.map((t) => [t._id, t._creationTime]));
    const cycles: number[] = [];
    for (const m of messages) {
      if (!m.body.startsWith("⚡ Agent finished")) continue;
      const created = threadCreated.get(m.threadId);
      if (created !== undefined) cycles.push(m._creationTime - created);
    }
    cycles.sort((a, b) => a - b);
    const medianCycleMs = cycles.length > 0 ? cycles[Math.floor(cycles.length / 2)] : null;

    // Drafts pushed (merges live in GitHub; pushed drafts are our proxy).
    const draftsPushedThisWeek = agentEvents.filter((e) => {
      const ev = e.event as { type?: string; draft?: { pushed?: boolean } };
      return ev?.type === "result" && ev.draft?.pushed === true && e._creationTime >= weekAgo;
    }).length;

    return {
      weeklyActiveUsers: users.filter((u) => u.lastSeenAt >= weekAgo).length,
      totalUsers: users.length,
      threadsThisWeek: threads.filter((t) => t._creationTime >= weekAgo).length,
      threadsPriorWeek: threads.filter((t) => t._creationTime >= priorWeekAgo && t._creationTime < weekAgo)
        .length,
      medianCycleMs,
      agentRepliesTotal: cycles.length,
      draftsPushedThisWeek,
      testSessionsThisMonth: testSessions.filter((s) => s.startedAt >= now - 30 * 24 * 60 * 60 * 1000).length,
      testSessionsCompleted: testSessions.filter((s) => s.completedAt).length,
      errorsThisWeek: appErrors.filter((e) => e._creationTime >= weekAgo).length,
    };
  },
});

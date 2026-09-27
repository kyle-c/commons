import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { isLandingEvent, landingDay } from "./landingEvents";

/**
 * The marketing page's scoreboard: how many visits, and how many of them
 * reached each door (open the app, download, play with the stickers, try the
 * comment-to-draft demo). Counts only, per UTC day. No cookie, no visitor id,
 * no IP or user agent is ever stored, so there is nothing here to consent to
 * and nothing that could identify a person.
 *
 * Written by the public beacon at POST /api/lp (http.ts), which accepts only
 * the names below; anything else is dropped. Counts can be inflated by anyone
 * willing to script the beacon, which is fine for a scoreboard and why
 * nothing here ever drives behavior.
 *
 * The accepted event names live in landingEvents.ts.
 *
 * Read from the repo root with `pnpm stats` (last 14 days), or pass a span:
 * pnpm stats '{"days": 30}'. It runs the backend package's own Convex CLI,
 * so there's no download prompt (a bare `npx convex` from the root has none
 * installed and offers to fetch one).
 */
export const record = internalMutation({
  args: { event: v.string() },
  handler: async (ctx, { event }) => {
    if (!isLandingEvent(event)) return;
    const day = landingDay(Date.now());
    const row = await ctx.db
      .query("landingDaily")
      .withIndex("by_day_event", (q) => q.eq("day", day).eq("event", event))
      .unique();
    if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
    else await ctx.db.insert("landingDaily", { day, event, count: 1 });
  },
});

/** Day-by-day counts, newest first, with the funnel's rates alongside. */
export const recent = internalQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const span = Math.min(Math.max(days ?? 14, 1), 90);
    const since = landingDay(Date.now() - (span - 1) * 86_400_000);
    const rows = await ctx.db
      .query("landingDaily")
      .withIndex("by_day_event", (q) => q.gte("day", since))
      .collect();
    const byDay = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const d = byDay.get(r.day) ?? {};
      d[r.event] = r.count;
      byDay.set(r.day, d);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([day, c]) => {
        const views = c.view ?? 0;
        const rate = (n: number | undefined) => (views ? Math.round(((n ?? 0) / views) * 1000) / 10 : 0);
        return {
          day,
          ...c,
          openAppRate: rate(c.open_app),
          downloadRate: rate(c.download),
          demoSendRate: rate(c.turn_send),
        };
      });
  },
});

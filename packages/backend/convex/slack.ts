import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Slack bridge v1 (COM-6): a single incoming webhook, fired from mutations
 * via the scheduler so a slow Slack call never blocks a comment landing.
 * Unkeyed environments no-op (same convention as emails.ts / Resend) — set
 * SLACK_WEBHOOK_URL on the deployment to turn it on.
 *
 * commons:// deep links aren't linkified by Slack, so they ride along as
 * copyable text under the message.
 */
export const post = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, { text }) => {
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (!webhook) return;
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) console.error("slack webhook failed", res.status, await res.text());
    } catch (err) {
      console.error("slack webhook failed", err);
    }
  },
});

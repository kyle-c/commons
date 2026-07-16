import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Outbound email via Resend's REST API (https://resend.com/docs/api-reference).
// Without RESEND_API_KEY the actions log and no-op, so local dev works unkeyed.

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`RESEND_API_KEY not set — skipping email to ${to}: ${subject}`);
    return;
  }
  const from = process.env.EMAIL_FROM ?? "Commons <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) console.error(`Resend rejected email to ${to}:`, res.status, await res.text());
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const footer = `<p style="color:#888;font-size:13px;margin-top:24px">Sent by Commons. Open the link in the app; if you don't have Commons installed, ask your team for the build.</p>`;

export const sendMentionEmail = internalAction({
  args: {
    recipients: v.array(v.object({ email: v.string(), name: v.string() })),
    authorName: v.string(),
    projectName: v.string(),
    snippet: v.string(),
    deepLink: v.string(),
  },
  handler: async (_ctx, { recipients, authorName, projectName, snippet, deepLink }) => {
    const subject = `${authorName} mentioned you in ${projectName}`;
    const html = `
<div style="font:15px/1.6 -apple-system,system-ui,sans-serif;color:#222;max-width:480px">
  <p><strong>${escapeHtml(authorName)}</strong> mentioned you in <strong>${escapeHtml(projectName)}</strong>:</p>
  <blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #6b8afd;background:#f5f6fa;border-radius:4px">
    ${escapeHtml(snippet)}
  </blockquote>
  <p><a href="${deepLink}" style="color:#4c6ef5">Open the thread in Commons</a></p>
  ${footer}
</div>`;
    await Promise.all(recipients.map((r) => sendEmail(r.email, subject, html)));
  },
});

export const sendInviteEmail = internalAction({
  args: { email: v.string(), inviterName: v.string() },
  handler: async (_ctx, { email, inviterName }) => {
    const subject = `${inviterName} invited you to Commons`;
    const html = `
<div style="font:15px/1.6 -apple-system,system-ui,sans-serif;color:#222;max-width:480px">
  <p><strong>${escapeHtml(inviterName)}</strong> invited you to the team's Commons workspace — the shared canvas for designing in Figma and code.</p>
  <p>Install the Commons app (ask ${escapeHtml(inviterName)} for the build), then sign in with Google using <strong>${escapeHtml(email)}</strong>.</p>
  ${footer}
</div>`;
    await sendEmail(email, subject, html);
  },
});

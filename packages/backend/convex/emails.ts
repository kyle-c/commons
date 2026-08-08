import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { siteUrl } from "./siteUrl";

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

export const sendMagicLinkEmail = internalAction({
  args: { email: v.string(), link: v.string() },
  handler: async (_ctx, { email, link }) => {
    const html = `
<div style="font:15px/1.6 -apple-system,system-ui,sans-serif;color:#222;max-width:480px">
  <p>Click to sign in to Commons:</p>
  <p><a href="${link}" style="display:inline-block;background:#4c6ef5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Sign in to Commons</a></p>
  <p style="color:#888;font-size:13px">This link works once and expires in 15 minutes. If you didn't request it, ignore this email.</p>
</div>`;
    // Dev convenience: print the link so local sign-ins work without email.
    // Gated on an EXPLICIT dev flag, never on a missing RESEND_API_KEY — a
    // prod deploy that lost its key must not start logging live auth links
    // (each redeems to a session) into the Convex logs.
    if (process.env.COMMONS_DEV === "1") console.log(`magic link for ${email}: ${link}`);
    await sendEmail(email, "Your Commons sign-in link", html);
  },
});

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

/**
 * ID-11: the invite email is the product's front door, not a courtesy nudge.
 * It says what Commons is, opens in the browser with zero install (deep into
 * the shared project when the invite came from one — the app's hash routing
 * picks it up after sign-in), and offers the Mac download as the secondary
 * path. The old version said "ask your teammate for the build", which was
 * true before trycommons.app hosted a signed DMG and false ever since.
 */
export const sendInviteEmail = internalAction({
  args: {
    email: v.string(),
    inviterName: v.string(),
    projectId: v.optional(v.string()),
    projectName: v.optional(v.string()),
  },
  handler: async (_ctx, { email, inviterName, projectId, projectName }) => {
    const site = siteUrl();
    const openUrl = projectId ? `${site}/app#p=${projectId}&view=canvas` : `${site}/app`;
    const invitedTo = projectName
      ? `<strong>${escapeHtml(projectName)}</strong> on Commons`
      : `the team's Commons workspace`;
    const subject = projectName
      ? `${inviterName} invited you to ${projectName} on Commons`
      : `${inviterName} invited you to Commons`;
    const html = `
<div style="font:15px/1.6 -apple-system,system-ui,sans-serif;color:#222;max-width:480px">
  <p><strong>${escapeHtml(inviterName)}</strong> invited you to ${invitedTo}.</p>
  <p style="color:#555">Commons is a shared canvas showing the team's app as it actually runs —
  you comment on real screens, and feedback becomes working drafts.</p>
  <p style="margin:24px 0">
    <a href="${openUrl}" style="background:#1f7a6e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:500">Open Commons in your browser</a>
  </p>
  <p style="color:#555">Sign in with Google or an email link using <strong>${escapeHtml(email)}</strong> — no install needed.
  On a Mac, the <a href="${site}/download" style="color:#1f7a6e">desktop app</a> adds live dev servers and agents.</p>
  <p style="color:#888;font-size:13px;margin-top:24px">Sent by Commons · <a href="${site}" style="color:#888">trycommons.app</a></p>
</div>`;
    await sendEmail(email, subject, html);
  },
});

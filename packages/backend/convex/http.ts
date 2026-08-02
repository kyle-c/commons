import { httpRouter } from "convex/server";
import { googleCallbackUrl, siteUrl } from "./siteUrl";
import { landingHtml } from "./landing";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildAuthCallbackUrl } from "@commons/shared";

const http = httpRouter();

// trycommons.app lands here: the marketing page at the site root.
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async (ctx) => {
    // The page shows which build /download will hand you, so the claim on the
    // button is checkable rather than a promise.
    const release = await ctx.runQuery(internal.updates.latest, {});
    return new Response(landingHtml(release?.version), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
    });
  }),
});

/**
 * One stable download URL that always points at the current DMG.
 *
 * The artifact filename carries its version, so nothing static can link to
 * "the latest" — and hand-editing the landing page each release is exactly
 * the kind of step that gets forgotten. This reads the same record the
 * auto-updater uses, so the website and the update feed can never disagree
 * about what the current build is.
 */
http.route({
  path: "/download",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const release = await ctx.runQuery(internal.updates.latest, {});
    const dmg = release?.files.find((f) => f.name.endsWith(".dmg"));
    const url = dmg ? await ctx.storage.getUrl(dmg.storageId) : null;
    // Nothing published yet (or storage lost the file): send people to the
    // releases page rather than a dead end.
    if (!url) {
      return new Response(null, {
        status: 302,
        headers: { Location: "https://github.com/kyle-c/commons/releases/latest" },
      });
    }
    return new Response(null, {
      status: 302,
      // no-store: this URL's whole job is to be re-resolved every time.
      headers: { Location: url, "Cache-Control": "no-store" },
    });
  }),
});

// Google's authorization-code redirect. Exchanges the code, records the result
// on the authSession, then bounces the browser back into the app via the
// commons:// deep link (with the live `auth.status` query as the fallback path).
http.route({
  path: "/auth/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");

    if (!state) return page("Sign-in failed", "The sign-in link is malformed. Return to Commons and try again.");
    if (oauthError || !code) {
      await ctx.runMutation(internal.auth.failAuthSession, { state, error: oauthError ?? "no_code" });
      return page("Sign-in cancelled", "Google didn't complete the sign-in. Return to Commons and try again.");
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: googleCallbackUrl(),
      }),
    });
    if (!tokenRes.ok) {
      console.error("Google token exchange failed", tokenRes.status, await tokenRes.text());
      await ctx.runMutation(internal.auth.failAuthSession, { state, error: "token_exchange_failed" });
      return page("Sign-in failed", "Google rejected the sign-in. Return to Commons and try again.");
    }

    // The id_token comes straight from Google's token endpoint over TLS, so its
    // claims are trusted without re-verifying the signature.
    const { id_token } = (await tokenRes.json()) as { id_token: string };
    const claims = decodeJwtPayload(id_token) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
      sub: string;
    };
    if (!claims.email || claims.email_verified === false) {
      await ctx.runMutation(internal.auth.failAuthSession, { state, error: "unverified_email" });
      return page("Sign-in failed", "That Google account has no verified email address.");
    }

    const result = await ctx.runMutation(internal.auth.completeGoogleSignIn, {
      state,
      email: claims.email,
      name: claims.name ?? claims.email.split("@")[0],
      googleId: claims.sub,
      avatarUrl: claims.picture,
    });
    if (!result.ok) {
      if (result.reason === "email_in_use") {
        return page("Email already in use", `${claims.email} already belongs to another Commons account.`);
      }
      return page(
        "That sign-in link is no longer valid",
        "Each sign-in attempt works once — this one was already used, cancelled, or timed out. " +
          "Go back to the Commons tab and press Continue with Google again; a fresh attempt will go straight through."
      );
    }
    if ("linked" in result && result.linked) {
      return page("Email linked", `${result.email} is now linked to your Commons account — you can close this tab.`);
    }

    return page("Signed in", "Returning you to Commons — you can close this tab.", buildAuthCallbackUrl(state));
  }),
});

/**
 * Guest mode: the real web app, scoped by a share token (Phase 3).
 *
 * Serves the same shell as /app. The client sees /g/<token> in its own URL,
 * reads projects.sharePage instead of the session-scoped queries, and renders
 * the actual canvas rather than a second implementation of one.
 *
 * Lives alongside /p/ rather than replacing it: share links are already out
 * in the world, and they keep working until this reaches parity. The 512-line
 * template below is deleted at that point, not before.
 */
http.route({
  pathPrefix: "/g/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const rest = new URL(request.url).pathname.slice("/g/".length);
    // The unfurl image: /g/<token>/og.png answers with the home screen's
    // latest snapshot. Slack and friends fetch this from the og:image tag.
    if (rest.endsWith("/og.png")) {
      const token = rest.slice(0, -"/og.png".length).replace(/\/+$/, "");
      const og = await ctx.runQuery(internal.projects.ogForShareToken, { shareToken: token });
      if (!og?.imageUrl) return new Response("no snapshot yet", { status: 404 });
      return new Response(null, {
        status: 302,
        headers: { Location: og.imageUrl, "Cache-Control": "no-store" },
      });
    }
    const bundle = await ctx.runQuery(internal.updates.latestWebApp, {});
    if (!bundle) return page("Not published", "The Commons web app hasn't been published yet.");
    // A pasted share link should unfurl into a card that sells the click:
    // the project's name, what the page is, and a real screenshot. This is
    // the prototype embedded in Slack, to the extent Slack allows embedding —
    // the card is the demo, the click is the product.
    const token = rest.replace(/\/+$/, "");
    const og = token ? await ctx.runQuery(internal.projects.ogForShareToken, { shareToken: token }) : null;
    let html = bundle.indexHtml;
    if (og) {
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      const tags = [
        `<meta property="og:title" content="${esc(og.name)} — a live canvas on Commons" />`,
        `<meta property="og:description" content="Pan the real screens, click into the running prototype, and leave comments. No account needed." />`,
        `<meta property="og:type" content="website" />`,
        og.imageUrl ? `<meta property="og:image" content="${siteUrl()}/g/${esc(token)}/og.png" />` : "",
        og.imageUrl ? `<meta name="twitter:card" content="summary_large_image" />` : `<meta name="twitter:card" content="summary" />`,
      ].join("\n");
      html = html.replace("<head>", `<head>\n${tags}`);
    }
    return new Response(html, {
      status: 200,
      // The token is in the path, so this must never be cached as one page.
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }),
});

// The old share page's address. Guest mode (/g/) reached parity, so the 512
// lines of duplicate canvas that lived here are gone; links already out in
// the world land on the real thing instead. Same token, richer page.
http.route({
  pathPrefix: "/p/",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const shareToken = new URL(request.url).pathname.slice("/p/".length).replace(/\/+$/, "");
    return new Response(null, {
      status: 302,
      headers: { Location: `/g/${shareToken}`, "Cache-Control": "no-store" },
    });
  }),
});

// GitHub App webhook: Commons learns preview URLs and branch patterns by
// watching deployments instead of asking a human to paste them. Every request
// is HMAC-verified against GITHUB_WEBHOOK_SECRET before it is trusted.
http.route({
  path: "/api/github/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return new Response("not configured", { status: 503 });

    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const body = await request.text();
    if (!(await verifyGithubSignature(secret, body, signature))) {
      return new Response("bad signature", { status: 401 });
    }

    const event = request.headers.get("x-github-event") ?? "";
    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("bad json", { status: 400 });
    }

    if (event === "installation") {
      const action = payload.action;
      await ctx.runMutation(internal.github.recordInstallation, {
        installationId: Number(payload.installation?.id ?? 0),
        accountLogin: String(payload.installation?.account?.login ?? "unknown"),
        removed: action === "deleted" || action === "suspend",
      });
      return new Response("ok");
    }

    if (event === "deployment_status") {
      const state = payload.deployment_status?.state;
      const url = payload.deployment_status?.environment_url ?? payload.deployment_status?.target_url;
      if (state !== "success" || !url) return new Response("ignored");
      const repo = payload.repository ?? {};
      // Vercel puts the commit SHA in deployment.ref, not the branch. One
      // lookup recovers the real name; without it the sample would store a
      // SHA in a column called "branch" and inference could never work.
      let branchName = String(payload.deployment?.ref ?? "");
      if (/^[0-9a-f]{40}$/.test(branchName) && repo.full_name && payload.installation?.id) {
        const resolved = await ctx.runAction(internal.githubApp.resolveRefToBranch, {
          installationId: Number(payload.installation.id),
          repoFullName: String(repo.full_name),
          sha: branchName,
        });
        if (resolved) branchName = resolved;
      }
      const result = await ctx.runMutation(internal.github.handleDeployment, {
        installationId: Number(payload.installation?.id ?? 0),
        repoUrls: [repo.html_url, repo.clone_url, repo.ssh_url, repo.full_name].filter(
          (u: unknown): u is string => typeof u === "string" && u.length > 0
        ),
        branch: branchName,
        sha: typeof payload.deployment?.sha === "string" ? payload.deployment.sha : undefined,
        defaultBranch: String(repo.default_branch ?? "main"),
        environment: payload.deployment_status?.environment ?? payload.deployment?.environment,
        environmentUrl: String(url),
      });
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("ignored");
  }),
});

// The App's Setup URL. GitHub sends people here after they install or
// reconfigure, with installation_id and the state token we minted. This is
// where an installation becomes a workspace's installation.
http.route({
  path: "/api/github/setup",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const installationId = Number(params.get("installation_id") ?? 0);
    const state = params.get("state") ?? "";

    if (!installationId) return setupPage("Nothing to connect", NO_INSTALL_BODY);
    if (!state) return setupPage("Almost there", NO_STATE_BODY);

    const result = await ctx.runMutation(internal.github.completeConnect, {
      state,
      installationId,
      accountLogin: params.get("account") ?? undefined,
    });
    if (!result.ok) return setupPage("Couldn't finish connecting", SETUP_REASONS[result.reason] ?? NO_STATE_BODY);

    const account = escapeHtml(result.accountLogin);
    const workspace = escapeHtml(result.workspaceName);

    // Reconnecting an account that was already linked changes nothing. Saying
    // "Connected" here would be true and useless: it reads as success while
    // the account you actually meant is still missing. GitHub sends you to
    // whichever account you're signed in as, so this is easy to hit twice.
    if (result.alreadyLinked) {
      return setupPage(
        "Already connected",
        `<p><strong>${account}</strong> was already linked to <strong>${workspace}</strong>, so nothing changed.</p>
         <p>If you meant a different GitHub account, that's the thing to fix: GitHub connected you as
         <strong>${account}</strong> because that's the account you're signed in as. Switch accounts on GitHub,
         then click Connect GitHub in Commons again.</p>`
      );
    }
    return setupPage(
      "Connected",
      `<p><strong>${account}</strong> is now linked to <strong>${workspace}</strong>.</p>
       <p>When one of those repos deploys, Commons picks up the preview URL on its own. You can close this tab and go back to the app.</p>`
    );
  }),
});

const NO_INSTALL_BODY = `<p>GitHub sent us here without an installation to connect.</p>
  <p>Start from Commons instead: open the workspaces menu and click Connect GitHub.</p>`;

const NO_STATE_BODY = `<p>We can't tell which workspace this installation belongs to, so we haven't linked anything.</p>
  <p>Open Commons, go to the workspaces menu, and click Connect GitHub. That link carries the workspace with it.</p>`;

const SETUP_REASONS: Record<string, string> = {
  expired: `<p>That connect link sat for more than 15 minutes, so it expired.</p>
    <p>Click Connect GitHub in Commons again — the install itself is fine, it just needs a fresh link.</p>`,
  already_used: `<p>That connect link was already used.</p>
    <p>If the connection isn't showing in Commons, click Connect GitHub again.</p>`,
  not_allowed: `<p>You're not a member of the workspace that link was made for.</p>`,
  unknown_state: NO_STATE_BODY,
  unknown_workspace: `<p>That workspace no longer exists.</p>`,
};

/** A plain, self-contained page: this is the one screen of Commons that has to work in any browser. */
function setupPage(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${escapeHtml(title)} · Commons</title><style>
     :root{color-scheme:light dark}
     body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f0e8;color:#26251e;
       font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}
     main{max-width:26rem;background:#fbf9f4;border:1px solid #d8d3c4;border-radius:12px;padding:28px 30px}
     h1{margin:0 0 12px;font-size:19px;letter-spacing:-.01em}
     p{margin:0 0 12px;color:#5c5a4f} p:last-child{margin-bottom:0} strong{color:#26251e}
     @media (prefers-color-scheme:dark){body{background:#1a1b17;color:#edebe0}
       main{background:#21221d;border-color:#363730} p{color:#a3a195} strong{color:#edebe0}}
     </style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/** Constant-time compare of GitHub's sha256 HMAC over the raw body. */
async function verifyGithubSignature(secret: string, body: string, header: string): Promise<boolean> {
  if (!header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Guest comments from the share page — token-gated, capped, no accounts.
http.route({
  path: "/api/p/thread",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.token !== "string" || typeof body.body !== "string" || !body.body.trim()) {
      return json({ error: "bad_request" }, 400);
    }
    try {
      const threadId = await ctx.runMutation(internal.comments.guestThread, {
        shareToken: body.token,
        frameId: typeof body.frameId === "string" ? (body.frameId as never) : undefined,
        fx: typeof body.fx === "number" ? body.fx : undefined,
        fy: typeof body.fy === "number" ? body.fy : undefined,
        canvasX: typeof body.canvasX === "number" ? body.canvasX : undefined,
        canvasY: typeof body.canvasY === "number" ? body.canvasY : undefined,
        name: typeof body.name === "string" ? body.name : "Guest",
        body: body.body,
      });
      return threadId ? json({ threadId }) : json({ error: "not_found" }, 404);
    } catch {
      return json({ error: "bad_request" }, 400);
    }
  }),
});

http.route({
  path: "/api/p/reply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body.token !== "string" ||
      typeof body.threadId !== "string" ||
      typeof body.body !== "string" ||
      !body.body.trim()
    ) {
      return json({ error: "bad_request" }, 400);
    }
    try {
      const messageId = await ctx.runMutation(internal.comments.guestReply, {
        shareToken: body.token,
        threadId: body.threadId as never,
        name: typeof body.name === "string" ? body.name : "Guest",
        body: body.body,
      });
      return messageId ? json({ ok: true }) : json({ error: "not_found" }, 404);
    } catch {
      return json({ error: "bad_request" }, 400);
    }
  }),
});

// ── Cloud agent runner (AG-10) ──────────────────────────────────────────────
// The GitHub Actions runner's write path. The runToken minted at dispatch is
// the whole credential: it has only ever existed in the payload GitHub
// delivered to the repo's own workflow, and it scopes to one session.

http.route({
  path: "/api/agent/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.sessionId !== "string" || typeof body.runToken !== "string" || !body.event) {
      return json({ error: "bad_request" }, 400);
    }
    const result = await ctx.runMutation(internal.cloudAgents.ingestEvent, {
      sessionId: body.sessionId as never,
      runToken: body.runToken,
      // Validated by agentEventValidator inside the mutation; untyped here
      // because it arrived as raw JSON from the Actions runner.
      event: body.event as never,
    });
    return json(result, result.ok ? 200 : 403);
  }),
});

http.route({
  path: "/api/agent/done",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.sessionId !== "string" || typeof body.runToken !== "string") {
      return json({ error: "bad_request" }, 400);
    }
    const result = await ctx.runMutation(internal.cloudAgents.finishRun, {
      sessionId: body.sessionId as never,
      runToken: body.runToken,
      ok: body.ok === true,
      summary: typeof body.summary === "string" ? body.summary.slice(0, 4000) : "",
      editedFiles: Array.isArray(body.editedFiles)
        ? body.editedFiles.filter((f): f is string => typeof f === "string").slice(0, 200)
        : [],
      numTurns: typeof body.numTurns === "number" ? body.numTurns : 0,
      durationMs: typeof body.durationMs === "number" ? body.durationMs : 0,
      totalCostUsd: typeof body.totalCostUsd === "number" ? body.totalCostUsd : undefined,
    });
    return json(result, result.ok ? 200 : 403);
  }),
});

// The two files cloud-agent setup asks a human to look at. Served with the
// product so they version with it, and so the workflow can fetch the runner
// fresh at run time (fixes ship without touching anyone's repo).
http.route({
  path: "/setup/commons-agent.yml",
  method: "GET",
  handler: httpAction(async () => {
    const { WORKFLOW_FILE } = await import("./cloudAgents");
    return new Response(WORKFLOW_FILE, {
      headers: { "Content-Type": "text/yaml; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }),
});

http.route({
  path: "/setup/flow-crawler.mjs",
  method: "GET",
  handler: httpAction(async () => {
    const { FLOW_CRAWLER } = await import("./flows");
    return new Response(FLOW_CRAWLER, {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }),
});

// The crawl's write path: PNG body + metadata in the query. The runToken is
// the credential (same model as the agent callbacks); it only ever existed in
// the dispatch payload GitHub delivered to the repo's own workflow.
http.route({
  path: "/api/flow/proposal",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const p = (k: string) => url.searchParams.get(k) ?? "";
    // Credentials come from headers now; the query fallback keeps a crawler
    // that started under the previous served script from failing mid-run.
    const crawlId = request.headers.get("X-Commons-Crawl") ?? p("crawlId");
    const runToken = request.headers.get("X-Commons-Token") ?? p("runToken");
    if (!crawlId || !runToken || !p("signature")) return json({ error: "bad_request" }, 400);
    // Authorize FIRST. Storing before the check meant a malformed id threw
    // inside the mutation, skipping the cleanup line and leaking the blob
    // permanently — unauthenticated, once per request.
    const crawl = await ctx.runQuery(internal.flows.crawlTokenOk, { crawlId, runToken });
    if (!crawl) return json({ ok: false, error: "forbidden" }, 403);

    const blob = await request.blob();
    if (blob.size === 0 || blob.size > 8_000_000) return json({ error: "bad_image" }, 400);
    const storageId = await ctx.storage.store(blob);
    try {
      const result = await ctx.runMutation(internal.flows.ingestCrawlProposal, {
        crawlId: crawl.id,
        runToken,
        storageId,
        routePath: p("routePath").slice(0, 256) || "/",
        stateLabel: p("stateLabel").slice(0, 60) || "state",
        trigger: p("trigger").slice(0, 120) || undefined,
        fromRoutePath: p("fromRoutePath").slice(0, 256) || undefined,
        signature: p("signature").slice(0, 200),
      });
      if (!result.ok) await ctx.storage.delete(storageId).catch(() => {});
      return json(result, result.ok ? 200 : 403);
    } catch (error) {
      // Any throw past this point must still free the blob.
      await ctx.storage.delete(storageId).catch(() => {});
      throw error;
    }
  }),
});

http.route({
  path: "/api/flow/done",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const finishId = request.headers.get("X-Commons-Crawl") ?? url.searchParams.get("crawlId") ?? "";
    const result = await ctx.runMutation(internal.flows.finishCrawl, {
      crawlId: finishId as never,
      runToken: request.headers.get("X-Commons-Token") ?? url.searchParams.get("runToken") ?? "",
      error: url.searchParams.get("error")?.slice(0, 500) || undefined,
    });
    return json(result, result.ok ? 200 : 403);
  }),
});

http.route({
  path: "/setup/agent-runner.mjs",
  method: "GET",
  handler: httpAction(async () => {
    const { RUNNER_SCRIPT } = await import("./cloudAgents");
    return new Response(RUNNER_SCRIPT, {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }),
});

// ── Visitor recruiting (UT intercept) ───────────────────────────────────────
// One script tag on the team's own site invites a sampled fraction of real
// visitors to take a live test. Config is baked in at serve time, so the
// snippet itself stays a dumb cacheable one-liner; a paused or closed test
// serves a no-op. Shadow DOM so the host page's CSS and ours never touch.

http.route({
  path: "/intercept.js",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get("t") ?? "";
    const config = token ? await ctx.runQuery(internal.userTests.interceptConfig, { token }) : null;
    const noop = "/* Commons intercept: no live test behind this token. */";
    if (!config) {
      return new Response(noop, {
        headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "max-age=300" },
      });
    }
    const script = interceptScript(token, config.rate, config.label ?? "this site", siteUrl());
    return new Response(script, {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "max-age=300" },
    });
  }),
});

/** The intercept card, self-contained. Brand-voiced, dismissible, capped. */
function interceptScript(token: string, rate: number, label: string, origin: string): string {
  const safeLabel = label.replace(/[<>&\\]/g, "");
  const html = `
    <style>
      .card { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
        max-width: 300px; background: #faf8f0; color: #26251e;
        border: 1px solid rgba(38,37,30,0.14); border-radius: 12px;
        padding: 16px 18px; box-shadow: 0 12px 40px rgba(20,20,14,0.18);
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      h3 { margin: 0 0 6px; font: 600 16px/1.3 "Iowan Old Style", Palatino, Georgia, serif; }
      p { margin: 0 0 12px; color: rgba(38,37,30,0.75); }
      .row { display: flex; gap: 10px; align-items: center; }
      button.go { background: #2e7d74; color: #faf8f0; border: 0; border-radius: 8px;
        padding: 7px 14px; font: 600 13px/1 inherit; cursor: pointer; }
      button.no { background: none; border: 0; color: rgba(38,37,30,0.55);
        font: 13px/1 inherit; cursor: pointer; padding: 7px 4px; }
      @media (prefers-color-scheme: dark) {
        .card { background: #23241f; color: #ece9dd; border-color: rgba(236,233,221,0.14); }
        p { color: rgba(236,233,221,0.7); }
        button.no { color: rgba(236,233,221,0.55); }
      }
    </style>
    <div class="card" role="dialog" aria-label="Feedback invitation">
      <h3>Got two minutes?</h3>
      <p>Help improve ${safeLabel} — a quick task, right here in your browser. No signup.</p>
      <div class="row">
        <button class="go">Try it</button>
        <button class="no">No thanks</button>
      </div>
    </div>`;

  // The generated code receives the markup as a JSON string literal, so no
  // nesting of template syntax ever happens (the first draft tried, and the
  // escaping ate itself).
  return [
    "(() => {",
    `  const KEY = "commons.intercept.${token}";`,
    "  try {",
    '    const seen = localStorage.getItem(KEY);',
    '    if (seen === "dismissed" || seen === "opened") return;',
    '    let roll = localStorage.getItem(KEY + ".roll");',
    '    if (roll === null) { roll = String(Math.random()); localStorage.setItem(KEY + ".roll", roll); }',
    `    if (parseFloat(roll) > ${rate}) return;`,
    "  } catch { return; }",
    '  const host = document.createElement("div");',
    '  const root = host.attachShadow({ mode: "closed" });',
    `  root.innerHTML = ${JSON.stringify(html)};`,
    '  root.querySelector(".go").addEventListener("click", () => {',
    '    try { localStorage.setItem(KEY, "opened"); } catch {}',
    `    window.open("${origin}/t/${token}", "_blank", "noopener");`,
    "    host.remove();",
    "  });",
    '  root.querySelector(".no").addEventListener("click", () => {',
    '    try { localStorage.setItem(KEY, "dismissed"); } catch {}',
    "    host.remove();",
    "  });",
    "  const mount = () => document.body.appendChild(host);",
    "  if (document.body) setTimeout(mount, 4000); else addEventListener(\"DOMContentLoaded\", () => setTimeout(mount, 4000));",
    "})();",
  ].join("\n");
}

// Crash/error ingestion from installed apps. Deliberately unauthenticated
// (errors can happen before sign-in) but size-capped and deduped server-side.
http.route({
  path: "/api/error",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.message !== "string") return json({ error: "bad_request" }, 400);
    const surface = body.surface === "main" || body.surface === "react" ? body.surface : "renderer";
    await ctx.runMutation(internal.errors.report, {
      version: typeof body.version === "string" ? body.version.slice(0, 40) : "unknown",
      surface,
      message: body.message.slice(0, 500),
      stack: typeof body.stack === "string" ? body.stack.slice(0, 4000) : undefined,
      email: typeof body.email === "string" ? body.email.slice(0, 200) : undefined,
    });
    return json({ ok: true });
  }),
});

// The web app: the same renderer the desktop wraps, for anyone in a browser
// (clients on Windows, PMs, phones). Sign-in and all collaboration work;
// desktop-only powers (repos, dev servers, agent hosting) hide themselves.
http.route({
  path: "/app",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const bundle = await ctx.runQuery(internal.updates.latestWebApp, {});
    if (!bundle) return page("Not published", "The Commons web app hasn't been published yet.");
    return new Response(bundle.indexHtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }),
});

http.route({
  pathPrefix: "/app/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    // ?v=<publish> cache-buster rides the URL; the lookup ignores it.
    const name = decodeURIComponent(new URL(request.url).pathname.slice("/app/".length));
    const bundle = await ctx.runQuery(internal.updates.latestWebApp, {});
    if (!bundle) return page("Not published", "The Commons web app hasn't been published yet.");
    const file = bundle.files.find((f) => f.name === name);
    const fileUrl = file ? await ctx.storage.getUrl(file.storageId) : null;
    if (!fileUrl) {
      // SPA fallback: unknown paths get the shell (hash routing does the rest).
      return new Response(bundle.indexHtml, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
    // no-store: republishing deletes old bundle files, so a cached redirect
    // would point at a dead storage id (white screen).
    return new Response(null, {
      status: 302,
      headers: { Location: fileUrl, "Cache-Control": "no-store" },
    });
  }),
});

// Magic-link landing: the emailed one-time token authorizes the pending
// sign-in; the app (desktop or web) completes via its live status subscription.
http.route({
  path: "/auth/email/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const emailToken = new URL(request.url).searchParams.get("token");
    if (!emailToken) return page("Sign-in failed", "This link is malformed — request a new one from Commons.");
    const result = await ctx.runMutation(internal.auth.completeEmailSignIn, { emailToken });
    if (!result.ok) {
      return page("Link expired", "Sign-in links work once and expire after 15 minutes. Request a new one from Commons.");
    }
    return page("Signed in", "Return to Commons — you're in.", buildAuthCallbackUrl(result.state));
  }),
});

// ---------------------------------------------------------------------------
// Desktop auto-update feed (electron-updater "generic" provider points here —
// see apps/desktop/electron-builder.yml). latest-mac.yml is served verbatim;
// artifacts 302 to Convex storage. Published by scripts/publish-update.mjs.
// ---------------------------------------------------------------------------

http.route({
  pathPrefix: "/update/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.slice("/update/".length));
    const release = await ctx.runQuery(internal.updates.latest, {});
    if (!release) return new Response("no releases published", { status: 404 });
    if (name === "latest-mac.yml") {
      return new Response(release.channelYml, {
        status: 200,
        headers: { "Content-Type": "text/yaml; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
    const file = release.files.find((f) => f.name === name);
    const url = file ? await ctx.storage.getUrl(file.storageId) : null;
    if (!url) return new Response("not found", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url } });
  }),
});

// ---------------------------------------------------------------------------
// User testing: anonymous tester harness + event ingestion + shareable report.
// Served straight off the deployment's .convex.site — no extra hosting.
// ---------------------------------------------------------------------------

// The tester-facing harness. Wraps the project's deployed preview in a device
// frame, walks the tester through tasks/questions, and records route + click
// events relayed by the in-app snippet (see /commons-testing.js).
http.route({
  pathPrefix: "/t/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).pathname.slice("/t/".length).replace(/\/+$/, "");
    const data = token ? await ctx.runQuery(internal.userTests.pageData, { token }) : null;
    if (!data) return page("Test not found", "This link is broken or the test was deleted.");
    if (data.test.status !== "live")
      return page("Test closed", "This usability test is no longer accepting responses. Thanks for your interest!");
    if (!data.previewUrl)
      return page("Test not ready", "The team hasn't published a preview of the app yet. Check back soon.");
    return new Response(testerHarnessHtml(data.test, data.previewUrl), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }),
});

// The instrumentation snippet target apps include with one script tag. It only
// activates inside an iframe and only relays navigation + click positions —
// it never reads keystrokes or input values.
http.route({
  path: "/commons-testing.js",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(TESTING_SNIPPET, {
      status: 200,
      headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" },
    });
  }),
});

http.route({
  path: "/api/t/start",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as { token?: string; userAgent?: string };
    if (typeof body.token !== "string") return json({ error: "bad_request" }, 400);
    const started = await ctx.runMutation(internal.userTests.startSession, {
      token: body.token,
      userAgent: typeof body.userAgent === "string" ? body.userAgent.slice(0, 300) : undefined,
    });
    return started ? json(started) : json({ error: "closed" }, 410);
  }),
});

http.route({
  path: "/api/t/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as { sessionId?: string; events?: unknown[] };
    if (typeof body.sessionId !== "string" || !Array.isArray(body.events)) return json({ error: "bad_request" }, 400);
    const events = body.events.slice(0, 200).flatMap((raw) => {
      const e = raw as Record<string, unknown>;
      if (e.kind !== "route" && e.kind !== "click") return [];
      return [
        {
          taskId: typeof e.taskId === "string" ? e.taskId : undefined,
          kind: e.kind as "route" | "click",
          route: typeof e.route === "string" ? e.route.slice(0, 500) : undefined,
          fx: typeof e.fx === "number" && isFinite(e.fx) ? e.fx : undefined,
          fy: typeof e.fy === "number" && isFinite(e.fy) ? e.fy : undefined,
          interactive: typeof e.interactive === "boolean" ? e.interactive : undefined,
          at: typeof e.at === "number" ? e.at : Date.now(),
        },
      ];
    });
    try {
      await ctx.runMutation(internal.userTests.recordEvents, {
        sessionId: body.sessionId as never,
        events,
      });
    } catch {
      return json({ error: "bad_session" }, 400);
    }
    return json({ ok: true });
  }),
});

http.route({
  path: "/api/t/task",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as { sessionId?: string; task?: Record<string, unknown> };
    const t = body.task;
    if (typeof body.sessionId !== "string" || !t || typeof t.taskId !== "string") return json({ error: "bad_request" }, 400);
    try {
      await ctx.runMutation(internal.userTests.recordTask, {
        sessionId: body.sessionId as never,
        task: {
          taskId: t.taskId,
          outcome: t.outcome === "gave_up" ? "gave_up" : "success",
          auto: t.auto === true,
          durationMs: typeof t.durationMs === "number" ? Math.max(0, t.durationMs) : 0,
          routeSequence: Array.isArray(t.routeSequence)
            ? (t.routeSequence.filter((r) => typeof r === "string") as string[]).slice(0, 100)
            : [],
          clickCount: typeof t.clickCount === "number" ? t.clickCount : 0,
          misclickCount: typeof t.misclickCount === "number" ? t.misclickCount : 0,
        },
      });
    } catch {
      return json({ error: "bad_session" }, 400);
    }
    return json({ ok: true });
  }),
});

http.route({
  path: "/api/t/finish",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as { sessionId?: string; answers?: unknown[] };
    if (typeof body.sessionId !== "string") return json({ error: "bad_request" }, 400);
    const answers = (Array.isArray(body.answers) ? body.answers : []).flatMap((raw) => {
      const a = raw as Record<string, unknown>;
      return typeof a.questionId === "string" && typeof a.value === "string"
        ? [{ questionId: a.questionId, value: a.value.slice(0, 4000) }]
        : [];
    });
    try {
      await ctx.runMutation(internal.userTests.finishSession, { sessionId: body.sessionId as never, answers });
    } catch {
      return json({ error: "bad_session" }, 400);
    }
    return json({ ok: true });
  }),
});

// Read-only aggregate report — safe to hand to stakeholders who don't have
// Commons. Gated by its own token, separate from the tester link.
http.route({
  pathPrefix: "/r/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const reportToken = new URL(request.url).pathname.slice("/r/".length).replace(/\/+$/, "");
    const data = reportToken ? await ctx.runQuery(internal.userTests.reportData, { reportToken }) : null;
    if (!data) return page("Report not found", "This link is broken or the test was deleted.");
    return new Response(reportHtml(data), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decodeJwtPayload(jwt: string): unknown {
  const base64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

function page(title: string, body: string, deepLink?: string): Response {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title} — Commons</title>
${deepLink ? `<meta http-equiv="refresh" content="0;url=${deepLink}" />` : ""}
<style>
  body { margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #1a1b17; color: #edebe0; font: 15px/1.6 -apple-system, system-ui, sans-serif; }
  .card { max-width: 420px; padding: 32px; background: #21221d; border: 1px solid #2a2b24; border-radius: 12px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-family: Georgia, 'Times New Roman', serif; font-weight: 600; }
  p { margin: 0; color: #a3a195; }
  a { color: #45a898; }
</style>
</head>
<body>
<div class="card">
  <h1>${title}</h1>
  <p>${body}</p>
  ${deepLink ? `<p style="margin-top:12px"><a href="${deepLink}">Open Commons</a> if it doesn't open automatically.</p>` : ""}
</div>
${deepLink ? `<script>location.href = ${JSON.stringify(deepLink)};</script>` : ""}
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// --- User-testing page templates ---------------------------------------------

type TestDoc = {
  _id: string;
  title: string;
  token: string;
  startRoute: string;
  device: { width: number; height: number };
  tasks: { id: string; instruction: string; targetRoute?: string }[];
  questions: { id: string; prompt: string; kind: "scale" | "text" }[];
  variant?: { label: string; url: string };
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JSON safe to inline inside a <script> tag. */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function testerHarnessHtml(test: TestDoc, previewUrl: string): string {
  const config = {
    token: test.token,
    title: test.title,
    previewUrl: previewUrl.replace(/\/+$/, ""),
    // Variant sessions (assigned server-side at start) load this base instead.
    variantUrl: test.variant ? test.variant.url.replace(/\/+$/, "") : null,
    startRoute: test.startRoute,
    device: test.device,
    tasks: test.tasks,
    questions: test.questions,
  };
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(test.title)} — usability test</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden;
         background: #1a1b17; color: #edebe0; font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  .stage { flex: 1; display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 16px; }
  .device { background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 40px rgba(0,0,0,.5);
            transform-origin: top center; }
  .device iframe { border: 0; width: 100%; height: 100%; display: block; }
  .bar { flex: none; border-top: 1px solid #2a2b24; background: #21221d; padding: 14px 20px;
         display: flex; align-items: center; gap: 16px; }
  .bar .step { color: #a3a195; font-size: 12px; white-space: nowrap; }
  .bar .task { flex: 1; font-size: 15px; }
  .btn { border: 1px solid #46473d; background: #2b2c25; color: #edebe0; border-radius: 8px;
         padding: 8px 14px; font: inherit; cursor: pointer; }
  .btn.primary { background: #45a898; border-color: #45a898; color: #fff; }
  .btn.ghost { background: transparent; color: #a3a195; }
  .overlay { position: fixed; inset: 0; background: #1a1b17; display: flex; align-items: center;
             justify-content: center; padding: 24px; overflow: auto; z-index: 5; }
  .stage.pre { visibility: hidden; }
  .card { max-width: 480px; width: 100%; background: #21221d; border: 1px solid #2a2b24;
          border-radius: 12px; padding: 32px; }
  .card h1 { font-size: 22px; margin: 0 0 10px; font-family: Georgia, 'Times New Roman', serif; font-weight: 600; }
  .card p { color: #a3a195; margin: 0 0 12px; }
  .card .consent { font-size: 12px; color: #716f64; border-top: 1px solid #2a2b24; padding-top: 12px; margin-top: 16px; }
  .q { margin: 18px 0; }
  .q label { display: block; margin-bottom: 8px; }
  .q textarea { width: 100%; min-height: 70px; background: #1a1b17; color: #edebe0; border: 1px solid #2a2b24;
                border-radius: 8px; padding: 8px; font: inherit; }
  .scale { display: flex; gap: 8px; }
  .scale button { flex: 1; padding: 10px 0; border-radius: 8px; border: 1px solid #46473d;
                  background: #2b2c25; color: #edebe0; font: inherit; cursor: pointer; }
  .scale button.on { background: #45a898; border-color: #45a898; color: #fff; }
  .flash { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); background: #45a898;
           color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 14px; display: none; z-index: 10; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div class="flash" id="flash">✓ Task complete</div>

<div class="overlay" id="intro">
  <div class="card">
    <h1>${escapeHtml(test.title)}</h1>
    <p>You'll be asked to complete ${test.tasks.length} short task${test.tasks.length === 1 ? "" : "s"} in a live app${
      test.questions.length ? ", then answer a couple of questions" : ""
    }. There are no wrong answers — we're testing the design, not you.</p>
    <p>Use the app exactly as you normally would. When you finish a task (or want to skip it), use the buttons at the bottom of the screen.</p>
    <button class="btn primary" id="start">Start</button>
    <div class="consent">This test records which screens you visit and where you click, anonymously.
    Nothing you type is recorded.</div>
  </div>
</div>

<div class="overlay hidden" id="questions"><div class="card" id="qcard"></div></div>

<div class="overlay hidden" id="done">
  <div class="card"><h1>That's it — thank you!</h1><p>Your responses were recorded. You can close this tab.</p></div>
</div>

<div class="stage pre" id="stage"><div class="device" id="device"><iframe id="app" title="App under test"></iframe></div></div>
<div class="bar" id="bar" style="display:none">
  <span class="step" id="step"></span>
  <span class="task" id="taskText"></span>
  <button class="btn primary" id="doneBtn">I did it</button>
  <button class="btn ghost" id="giveUpBtn">Skip / couldn't do it</button>
</div>

<script>
const CONFIG = ${inlineJson(config)};

// --- state ---
let sessionId = null;
let taskIndex = -1;
let taskStart = 0;
let taskRoutes = [];
let clicks = 0, misclicks = 0;
let finished = false;
const buffer = [];

const $ = (id) => document.getElementById(id);

// --- transport ---
function post(path, body) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).then((r) => r.json()).catch(() => null);
}
function flush() {
  if (!sessionId || buffer.length === 0) return;
  const events = buffer.splice(0, buffer.length);
  post("/api/t/events", { sessionId, events });
}
setInterval(flush, 2500);
addEventListener("pagehide", () => {
  if (!sessionId || buffer.length === 0) return;
  const events = buffer.splice(0, buffer.length);
  navigator.sendBeacon("/api/t/events", new Blob([JSON.stringify({ sessionId, events })], { type: "application/json" }));
});

// --- route matching: "/pay/[id]" and "/pay/:id" match "/pay/123" ---
function matchRoute(pattern, path) {
  if (!pattern) return false;
  const norm = (s) => ("/" + s).replace(/\\/+/g, "/").replace(/\\/$/, "") || "/";
  const p = norm(pattern).split("/"), a = norm(path).split("/");
  if (p.length !== a.length) return false;
  return p.every((seg, i) => (seg.startsWith("[") || seg.startsWith(":")) ? a[i].length > 0 : seg === a[i]);
}

// --- events from the instrumented app (via /commons-testing.js) ---
addEventListener("message", (e) => {
  const m = e.data;
  if (!m || m.__commonsTesting !== true || taskIndex < 0 || finished) return;
  const task = CONFIG.tasks[taskIndex];
  const taskId = task ? task.id : undefined;
  if (m.kind === "route" && typeof m.route === "string") {
    if (taskRoutes[taskRoutes.length - 1] !== m.route) taskRoutes.push(m.route);
    buffer.push({ taskId, kind: "route", route: m.route, at: Date.now() });
    if (task && matchRoute(task.targetRoute, m.route)) completeTask("success", true);
  } else if (m.kind === "click" && typeof m.fx === "number" && typeof m.fy === "number") {
    clicks++;
    if (m.interactive === false) misclicks++;
    buffer.push({ taskId, kind: "click", route: typeof m.route === "string" ? m.route : undefined,
                  fx: m.fx, fy: m.fy, interactive: m.interactive !== false, at: Date.now() });
  }
});

// --- task flow ---
function showTask() {
  const task = CONFIG.tasks[taskIndex];
  $("step").textContent = "Task " + (taskIndex + 1) + " of " + CONFIG.tasks.length;
  $("taskText").textContent = task.instruction;
  taskStart = Date.now();
  taskRoutes = [];
  clicks = 0; misclicks = 0;
}
function completeTask(outcome, auto) {
  const task = CONFIG.tasks[taskIndex];
  if (!task) return;
  post("/api/t/task", { sessionId, task: {
    taskId: task.id, outcome, auto: !!auto, durationMs: Date.now() - taskStart,
    routeSequence: taskRoutes, clickCount: clicks, misclickCount: misclicks,
  }});
  flush();
  if (auto) {
    $("flash").style.display = "block";
    setTimeout(() => { $("flash").style.display = "none"; }, 900);
  }
  taskIndex++;
  if (taskIndex < CONFIG.tasks.length) showTask();
  else if (CONFIG.questions.length > 0) showQuestions();
  else finish([]);
}

// --- questions ---
const answers = {};
function showQuestions() {
  $("bar").style.display = "none";
  const card = $("qcard");
  let html = "<h1>A few quick questions</h1>";
  for (const q of CONFIG.questions) {
    html += '<div class="q"><label>' + escapeText(q.prompt) + "</label>";
    if (q.kind === "scale") {
      html += '<div class="scale" data-q="' + q.id + '">';
      for (let i = 1; i <= 5; i++) html += '<button type="button" data-v="' + i + '">' + i + "</button>";
      html += "</div>";
    } else {
      html += '<textarea data-q="' + q.id + '"></textarea>';
    }
    html += "</div>";
  }
  html += '<button class="btn primary" id="submit">Submit</button>';
  card.innerHTML = html;
  card.querySelectorAll(".scale button").forEach((b) => b.addEventListener("click", () => {
    const group = b.parentElement;
    group.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    answers[group.dataset.q] = b.dataset.v;
  }));
  card.querySelectorAll("textarea").forEach((t) => t.addEventListener("input", () => { answers[t.dataset.q] = t.value; }));
  $("submit").addEventListener("click", () => {
    finish(CONFIG.questions.map((q) => ({ questionId: q.id, value: answers[q.id] || "" })));
  });
  $("questions").classList.remove("hidden");
}
function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
function finish(list) {
  finished = true;
  flush();
  post("/api/t/finish", { sessionId, answers: list });
  $("questions").classList.add("hidden");
  $("bar").style.display = "none";
  $("done").classList.remove("hidden");
}

// --- device sizing ---
function sizeDevice() {
  const device = $("device"), stage = $("stage");
  const w = CONFIG.device.width, h = CONFIG.device.height;
  if (!w) { device.style.width = "100%"; device.style.height = "100%"; device.style.borderRadius = "0"; return; }
  device.style.width = w + "px";
  device.style.height = (h || stage.clientHeight - 32) + "px";
  const scale = Math.min(1, (stage.clientWidth - 32) / w, (stage.clientHeight - 32) / (h || 1));
  device.style.transform = "scale(" + scale + ")";
}
addEventListener("resize", sizeDevice);

// --- start ---
$("start").addEventListener("click", async () => {
  const res = await post("/api/t/start", { token: CONFIG.token, userAgent: navigator.userAgent });
  if (!res || !res.sessionId) { alert("This test is no longer accepting responses."); return; }
  sessionId = res.sessionId;
  const base = res.variant === "b" && CONFIG.variantUrl ? CONFIG.variantUrl : CONFIG.previewUrl;
  $("intro").classList.add("hidden");
  $("stage").classList.remove("pre");
  $("bar").style.display = "flex";
  $("app").src = base + CONFIG.startRoute;
  sizeDevice();
  taskIndex = 0;
  showTask();
});
$("doneBtn").addEventListener("click", () => completeTask("success", false));
$("giveUpBtn").addEventListener("click", () => completeTask("gave_up", false));
</script>
</body>
</html>`;
}

// Kept as a template string (not a bundled file) so the snippet stays a single
// auditable screenful. Privacy invariant: navigation + click positions only.
const TESTING_SNIPPET = `/* Commons user-testing snippet — active only inside a test iframe.
   Records route changes and click positions. Never reads keystrokes or input values. */
(function () {
  if (window.top === window) return;
  function post(msg) {
    msg.__commonsTesting = true;
    try { window.parent.postMessage(msg, "*"); } catch (e) {}
  }
  var last = null;
  function sendRoute() {
    var r = location.pathname;
    if (r === last) return;
    last = r;
    post({ kind: "route", route: r });
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var orig = history[name];
    history[name] = function () {
      var out = orig.apply(this, arguments);
      setTimeout(sendRoute, 0);
      return out;
    };
  });
  window.addEventListener("popstate", sendRoute);
  window.addEventListener("hashchange", sendRoute);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sendRoute);
  else sendRoute();
  window.addEventListener("click", function (e) {
    var t = e.target instanceof Element ? e.target : null;
    var interactive = !!(t && t.closest("a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[onclick]"));
    post({
      kind: "click",
      route: location.pathname,
      fx: (e.clientX + window.scrollX) / window.innerWidth,
      fy: (e.clientY + window.scrollY) / window.innerWidth,
      interactive: interactive
    });
  }, true);
})();
`;

function reportHtml(data: {
  test: TestDoc & { _creationTime: number };
  sessions: {
    startedAt: number;
    completedAt?: number;
    instrumented: boolean;
    variant?: "a" | "b";
    tasks: {
      taskId: string;
      outcome: "success" | "gave_up";
      auto: boolean;
      durationMs: number;
      misclickCount: number;
      clickCount: number;
    }[];
    answers?: { questionId: string; value: string }[];
  }[];
  projectName: string;
}): string {
  const { test, sessions, projectName } = data;
  const completed = sessions.filter((s) => s.completedAt).length;
  const fmtSecs = (ms: number) => (ms >= 60000 ? `${Math.round(ms / 6000) / 10} min` : `${Math.round(ms / 100) / 10}s`);

  type TaskResult = (typeof sessions)[number]["tasks"][number];
  const statCells = (results: TaskResult[]) => {
    const successes = results.filter((r) => r.outcome === "success");
    const avgMs = successes.length ? successes.reduce((sum, r) => sum + r.durationMs, 0) / successes.length : 0;
    const clicksTotal = results.reduce((sum, r) => sum + r.clickCount, 0);
    const misclicksTotal = results.reduce((sum, r) => sum + r.misclickCount, 0);
    return `<td>${results.length}</td>
      <td>${results.length ? Math.round((successes.length / results.length) * 100) + "%" : "—"}</td>
      <td>${successes.length ? fmtSecs(avgMs) : "—"}</td>
      <td>${clicksTotal ? Math.round((misclicksTotal / clicksTotal) * 100) + "%" : "—"}</td>`;
  };

  // Variant tests (UT-11) report one row per variant so A/B reads side by side.
  const taskRows = test.tasks
    .map((task, i) => {
      const label = `${i + 1}. ${escapeHtml(task.instruction)}`;
      if (!test.variant) {
        const results = sessions.flatMap((s) => s.tasks.filter((t) => t.taskId === task.id));
        return `<tr><td>${label}</td>${statCells(results)}</tr>`;
      }
      const forVariant = (v: "a" | "b") =>
        sessions.filter((s) => (s.variant ?? "a") === v).flatMap((s) => s.tasks.filter((t) => t.taskId === task.id));
      return `<tr><td>${label} — <strong>A · current</strong></td>${statCells(forVariant("a"))}</tr>
        <tr><td style="color:#a3a195">↳ <strong>B · ${escapeHtml(test.variant.label)}</strong></td>${statCells(forVariant("b"))}</tr>`;
    })
    .join("");

  const questionRows = test.questions
    .map((q) => {
      const values = sessions.flatMap((s) => (s.answers ?? []).filter((a) => a.questionId === q.id && a.value !== ""));
      if (q.kind === "scale") {
        const nums = values.map((a) => Number(a.value)).filter((n) => n >= 1 && n <= 5);
        const avg = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
        return `<div class="q"><h3>${escapeHtml(q.prompt)}</h3>
          <p>${avg === null ? "No responses yet." : `<strong>${avg} / 5</strong> average · ${nums.length} response${nums.length === 1 ? "" : "s"}`}</p></div>`;
      }
      const items = values.map((a) => `<li>${escapeHtml(a.value)}</li>`).join("");
      return `<div class="q"><h3>${escapeHtml(q.prompt)}</h3>${items ? `<ul>${items}</ul>` : "<p>No responses yet.</p>"}</div>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(test.title)} — test report</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 40px 24px; background: #1a1b17; color: #edebe0;
         font: 15px/1.6 -apple-system, system-ui, sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 12px; }
  h3 { font-size: 14px; margin: 0 0 4px; }
  .sub { color: #a3a195; margin: 0 0 8px; }
  .stats { display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap; }
  .stat { background: #21221d; border: 1px solid #2a2b24; border-radius: 10px; padding: 14px 18px; }
  .stat strong { display: block; font-size: 22px; }
  .stat span { color: #a3a195; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: #21221d; border: 1px solid #2a2b24; border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #2a2b24; font-size: 13px; }
  th { color: #a3a195; font-weight: 500; }
  tr:last-child td { border-bottom: 0; }
  .q { background: #21221d; border: 1px solid #2a2b24; border-radius: 10px; padding: 16px 18px; margin-bottom: 12px; }
  .q p, .q ul { color: #c7c7cd; margin: 0; }
  .q ul { padding-left: 18px; }
  .foot { color: #6a6a72; font-size: 12px; margin-top: 40px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${escapeHtml(test.title)}</h1>
  <p class="sub">Usability test report · ${escapeHtml(projectName)}</p>
  <div class="stats">
    <div class="stat"><strong>${sessions.length}</strong><span>testers started</span></div>
    <div class="stat"><strong>${completed}</strong><span>completed</span></div>
    <div class="stat"><strong>${sessions.length ? Math.round((completed / sessions.length) * 100) + "%" : "—"}</strong><span>completion rate</span></div>
  </div>
  <h2>Tasks</h2>
  <table>
    <tr><th>Task</th><th>Attempts</th><th>Success</th><th>Avg time (successes)</th><th>Misclick rate</th></tr>
    ${taskRows}
  </table>
  ${test.questions.length ? `<h2>Questions</h2>${questionRows}` : ""}
  <div class="foot">Generated by Commons · anonymous sessions · clicks and screens only, no typed input recorded</div>
</div>
</body>
</html>`;
}

export default http;

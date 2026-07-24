import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildAuthCallbackUrl } from "@commons/shared";

const http = httpRouter();

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
        redirect_uri: `${process.env.CONVEX_SITE_URL}/auth/google/callback`,
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
      if (result.reason === "not_invited") {
        return page(
          "You need an invite",
          `Commons is invite-only. Ask a teammate to invite ${claims.email} (Team menu in the app), then sign in again.`
        );
      }
      if (result.reason === "email_in_use") {
        return page("Email already in use", `${claims.email} already belongs to another Commons account.`);
      }
      return page("Sign-in expired", "This sign-in took too long. Return to Commons and try again.");
    }
    if ("linked" in result && result.linked) {
      return page("Email linked", `${result.email} is now linked to your Commons account — you can close this tab.`);
    }

    return page("Signed in", "Returning you to Commons — you can close this tab.", buildAuthCallbackUrl(state));
  }),
});

// Read-only web share page (SNAP-4 / DL-3 lite): the canvas as snapshot
// images with thread pins and conversations — for anyone with the link,
// no install, no account. Token minted per project in Sharing.
http.route({
  pathPrefix: "/p/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const shareToken = new URL(request.url).pathname.slice("/p/".length).replace(/\/+$/, "");
    const data = shareToken ? await ctx.runQuery(internal.projects.sharePageData, { shareToken }) : null;
    if (!data) return page("Not found", "This share link is broken or was revoked.");
    return new Response(sharePageHtml(data), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }),
});

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
         background: #101012; color: #e7e7ea; font: 15px/1.6 -apple-system, system-ui, sans-serif; }
  .card { max-width: 420px; padding: 32px; background: #18181b; border: 1px solid #2a2a2f; border-radius: 12px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { margin: 0; color: #a1a1a8; }
  a { color: #7c9cf5; }
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
         background: #101012; color: #e7e7ea; font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  .stage { flex: 1; display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 16px; }
  .device { background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 40px rgba(0,0,0,.5);
            transform-origin: top center; }
  .device iframe { border: 0; width: 100%; height: 100%; display: block; }
  .bar { flex: none; border-top: 1px solid #2a2a2f; background: #18181b; padding: 14px 20px;
         display: flex; align-items: center; gap: 16px; }
  .bar .step { color: #a1a1a8; font-size: 12px; white-space: nowrap; }
  .bar .task { flex: 1; font-size: 15px; }
  .btn { border: 1px solid #3a3a41; background: #232328; color: #e7e7ea; border-radius: 8px;
         padding: 8px 14px; font: inherit; cursor: pointer; }
  .btn.primary { background: #4a6fdc; border-color: #4a6fdc; color: #fff; }
  .btn.ghost { background: transparent; color: #a1a1a8; }
  .overlay { position: fixed; inset: 0; background: #101012; display: flex; align-items: center;
             justify-content: center; padding: 24px; overflow: auto; z-index: 5; }
  .stage.pre { visibility: hidden; }
  .card { max-width: 480px; width: 100%; background: #18181b; border: 1px solid #2a2a2f;
          border-radius: 12px; padding: 32px; }
  .card h1 { font-size: 20px; margin: 0 0 10px; }
  .card p { color: #a1a1a8; margin: 0 0 12px; }
  .card .consent { font-size: 12px; color: #8a8a92; border-top: 1px solid #2a2a2f; padding-top: 12px; margin-top: 16px; }
  .q { margin: 18px 0; }
  .q label { display: block; margin-bottom: 8px; }
  .q textarea { width: 100%; min-height: 70px; background: #101012; color: #e7e7ea; border: 1px solid #2a2a2f;
                border-radius: 8px; padding: 8px; font: inherit; }
  .scale { display: flex; gap: 8px; }
  .scale button { flex: 1; padding: 10px 0; border-radius: 8px; border: 1px solid #3a3a41;
                  background: #232328; color: #e7e7ea; font: inherit; cursor: pointer; }
  .scale button.on { background: #4a6fdc; border-color: #4a6fdc; color: #fff; }
  .flash { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); background: #1f7a43;
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

function sharePageHtml(data: {
  name: string;
  projectId: string;
  frames: {
    _id: string;
    title: string;
    routePath?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    snapshotUrl: string | null;
  }[];
  threads: {
    _id: string;
    frameId?: string;
    fx?: number;
    fy?: number;
    canvasX?: number;
    canvasY?: number;
    resolvedAt?: number;
    messages: { body: string; at: number; authorName: string; avatarColor: string }[];
  }[];
}): string {
  const payload = {
    name: data.name,
    deepLink: `commons://project/${data.projectId}/canvas`,
    frames: data.frames.map((f) => ({
      id: f._id,
      title: f.title,
      route: f.routePath ?? null,
      x: f.x,
      y: f.y,
      w: f.width,
      h: f.height,
      img: f.snapshotUrl,
    })),
    threads: data.threads
      .filter((t) => t.messages.length > 0)
      .map((t) => ({
        id: t._id,
        frameId: t.frameId ?? null,
        fx: t.fx ?? null,
        fy: t.fy ?? null,
        cx: t.canvasX ?? null,
        cy: t.canvasY ?? null,
        resolved: !!t.resolvedAt,
        messages: t.messages.map((m) => ({
          body: m.body,
          authorName: m.authorName,
          avatarColor: m.avatarColor,
          at: m.at,
        })),
      })),
  };
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(data.name)} — Commons</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #101012; color: #e7e7ea; font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #2a2a2f;
           position: sticky; top: 0; background: #101012; z-index: 5; }
  header h1 { font-size: 16px; margin: 0; }
  header .hint { color: #7a7a82; font-size: 12px; }
  header a { margin-left: auto; color: #7c9cf5; text-decoration: none; font-size: 13px; }
  #stage-wrap { overflow: auto; padding: 32px; }
  #stage { position: relative; transform-origin: 0 0; }
  .frame { position: absolute; background: #18181b; border: 1px solid #2a2a2f; border-radius: 8px; overflow: hidden; }
  .frame img { display: block; width: 100%; height: calc(100% - 26px); object-fit: cover; object-position: top; background: #fff; }
  .frame .ph { display: flex; align-items: center; justify-content: center; height: calc(100% - 26px);
               color: #55555c; font-size: 12px; }
  .frame .cap { height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 11px;
                color: #a1a1a8; border-bottom: 1px solid #2a2a2f; }
  .pin { position: absolute; width: 24px; height: 24px; border-radius: 12px 12px 12px 2px; border: 2px solid #101012;
         color: #101012; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center;
         cursor: pointer; z-index: 3; }
  .pin.resolved { background: #3a3a41 !important; color: #9d9da6; }
  #panel { position: fixed; top: 60px; right: 16px; bottom: 16px; width: 340px; background: #18181b;
           border: 1px solid #2a2a2f; border-radius: 12px; padding: 14px; overflow-y: auto; display: none; z-index: 10; }
  #panel.open { display: block; }
  #panel .msg { margin-bottom: 12px; }
  #panel .who { font-weight: 600; font-size: 12px; }
  #panel .who small { color: #7a7a82; font-weight: 400; margin-left: 6px; }
  #panel .close { float: right; background: none; border: none; color: #a1a1a8; cursor: pointer; font-size: 14px; }
  footer { padding: 10px 20px 24px; color: #55555c; font-size: 12px; }
  .cbtn { background: #232328; border: 1px solid #3a3a41; color: #e7e7ea; border-radius: 8px;
          padding: 6px 12px; font: inherit; cursor: pointer; margin-left: 16px; }
  .cbtn.on { background: #4a6fdc; border-color: #4a6fdc; color: #fff; }
  body.commenting .frame { cursor: crosshair; }
  #panel input, #panel textarea { width: 100%; background: #101012; color: #e7e7ea; border: 1px solid #2a2a2f;
          border-radius: 8px; padding: 8px; font: inherit; margin-bottom: 8px; box-sizing: border-box; }
  #panel textarea { min-height: 64px; }
  #panel .send { background: #4a6fdc; border: none; color: #fff; border-radius: 8px; padding: 8px 14px;
          font: inherit; cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1 id="title"></h1>
  <span class="hint" id="counts"></span>
  <button class="cbtn" id="comment-mode" title="Then click anywhere on a screen to leave a comment">💬 Comment</button>
  <a id="open-app" href="#">Open in Commons →</a>
</header>
<div id="stage-wrap"><div id="stage"></div></div>
<div id="panel"></div>
<footer>Read-only view shared from Commons · snapshots update as the team works</footer>
<script>
const DATA = ${inlineJson(payload)};
const HEADER = 26;
document.getElementById("title").textContent = DATA.name;
document.getElementById("open-app").href = DATA.deepLink;
const open = DATA.threads.filter((t) => !t.resolved).length;
document.getElementById("counts").textContent =
  DATA.frames.length + " screens · " + (open ? open + " open threads" : "no open threads");

const pad = 60;
const minX = Math.min(...DATA.frames.map((f) => f.x), 0) - pad;
const minY = Math.min(...DATA.frames.map((f) => f.y), 0) - pad;
const maxX = Math.max(...DATA.frames.map((f) => f.x + f.w), 800) + pad;
const maxY = Math.max(...DATA.frames.map((f) => f.y + f.h + HEADER), 600) + pad;
const stage = document.getElementById("stage");
stage.style.width = maxX - minX + "px";
stage.style.height = maxY - minY + "px";
function fit() {
  const avail = document.getElementById("stage-wrap").clientWidth - 64;
  const scale = Math.min(1, avail / (maxX - minX));
  stage.style.transform = "scale(" + scale + ")";
  document.getElementById("stage-wrap").style.height = (maxY - minY) * scale + 64 + "px";
}
addEventListener("resize", fit);

const frameById = {};
for (const f of DATA.frames) {
  frameById[f.id] = f;
  const el = document.createElement("div");
  el.className = "frame";
  el.style.cssText = "left:" + (f.x - minX) + "px;top:" + (f.y - minY) + "px;width:" + f.w + "px;height:" + (f.h + HEADER) + "px";
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.textContent = f.title + (f.route ? "  ·  " + f.route : "");
  el.appendChild(cap);
  if (f.img) {
    const img = document.createElement("img");
    img.src = f.img;
    img.loading = "lazy";
    el.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "ph";
    ph.textContent = "no snapshot yet";
    el.appendChild(ph);
  }
  stage.appendChild(el);
}

const panel = document.getElementById("panel");
const TOKEN = decodeURIComponent(location.pathname.split("/p/")[1] || "").replace(/\\/+$/, "").split("?")[0];
// ?thread=<id> deep-links a ticket to the exact conversation (opened after pins render).
const WANTED_THREAD = new URLSearchParams(location.search).get("thread");
const savedName = () => localStorage.getItem("commons.guestName") || "";
function nameField(id) {
  return '<input id="' + id + '" placeholder="Your name" value="' + esc(savedName()) + '" maxlength="40" />';
}
async function postJson(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok ? res.json() : null;
}

function showThread(t) {
  let html = '<button class="close" onclick="panel.classList.remove(\\'open\\')">✕</button>';
  for (const m of t.messages) {
    const when = new Date(m.at).toLocaleDateString();
    html += '<div class="msg"><div class="who" style="color:' + m.avatarColor + '">' + esc(m.authorName) +
            "<small>" + when + '</small></div><div>' + esc(m.body) + "</div></div>";
  }
  html += '<div style="border-top:1px solid #2a2a2f;padding-top:12px">' + nameField("r-name") +
          '<textarea id="r-body" placeholder="Reply…"></textarea><button class="send" id="r-send">Reply</button></div>';
  panel.innerHTML = html;
  panel.classList.add("open");
  document.getElementById("r-send").addEventListener("click", async () => {
    const name = document.getElementById("r-name").value.trim() || "Guest";
    const body = document.getElementById("r-body").value.trim();
    if (!body) return;
    localStorage.setItem("commons.guestName", name);
    const ok = await postJson("/api/p/reply", { token: TOKEN, threadId: t.id, name, body });
    if (!ok) { alert("Couldn't post — the share link may have been revoked."); return; }
    t.messages.push({ body, authorName: name + " (guest)", avatarColor: "#9d9da6", at: Date.now() });
    showThread(t);
  });
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// Comment mode: click a screen to pin a new thread, no account needed.
let commenting = false;
document.getElementById("comment-mode").addEventListener("click", (e) => {
  commenting = !commenting;
  e.currentTarget.classList.toggle("on", commenting);
  document.body.classList.toggle("commenting", commenting);
});
function newThreadForm(frame, fx, fy) {
  panel.innerHTML =
    '<button class="close" onclick="panel.classList.remove(\\'open\\')">✕</button>' +
    '<div class="who" style="margin-bottom:8px">New comment on ' + esc(frame.title) + "</div>" +
    nameField("n-name") + '<textarea id="n-body" placeholder="What are you seeing?"></textarea>' +
    '<button class="send" id="n-send">Comment</button>';
  panel.classList.add("open");
  document.getElementById("n-send").addEventListener("click", async () => {
    const name = document.getElementById("n-name").value.trim() || "Guest";
    const body = document.getElementById("n-body").value.trim();
    if (!body) return;
    localStorage.setItem("commons.guestName", name);
    const res = await postJson("/api/p/thread", { token: TOKEN, frameId: frame.id, fx, fy, name, body });
    if (!res) { alert("Couldn't post — the share link may have been revoked."); return; }
    const t = { id: res.threadId, frameId: frame.id, fx, fy, cx: null, cy: null, resolved: false,
                messages: [{ body, authorName: name + " (guest)", avatarColor: "#9d9da6", at: Date.now() }] };
    DATA.threads.push(t);
    addPin(t);
    showThread(t);
  });
}

function addPin(t) {
  let x, y;
  if (t.frameId && frameById[t.frameId]) {
    const f = frameById[t.frameId];
    x = f.x + (t.fx ?? 0) * f.w;
    y = f.y + HEADER + (t.fy ?? 0) * f.h;
  } else if (t.cx !== null) {
    x = t.cx; y = t.cy;
  } else return;
  const first = t.messages[0];
  const pin = document.createElement("div");
  pin.className = "pin" + (t.resolved ? " resolved" : "");
  pin.style.cssText = "left:" + (x - minX - 12) + "px;top:" + (y - minY - 22) + "px;background:" + first.avatarColor;
  pin.textContent = first.authorName.split(" ").map((p) => (p.replace(/[^\\p{L}\\p{N}]/gu, ""))[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
  pin.addEventListener("click", (e) => { e.stopPropagation(); showThread(t); });
  stage.appendChild(pin);
}
DATA.threads.forEach(addPin);

// In comment mode, a click anywhere on a screen pins a new thread there.
document.querySelectorAll(".frame").forEach((el, i) => {
  const f = DATA.frames[i];
  el.addEventListener("click", (e) => {
    if (!commenting) return;
    const rect = el.getBoundingClientRect();
    const scale = rect.width / f.w;
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = ((e.clientY - rect.top) / scale - HEADER) / f.h;
    if (fy < 0) return; // clicked the caption bar
    newThreadForm(f, Math.min(1, Math.max(0, fx)), Math.min(1, Math.max(0, fy)));
  });
});
fit();

if (WANTED_THREAD) {
  const target = DATA.threads.find((t) => t.id === WANTED_THREAD);
  if (target) {
    showThread(target);
    const f = target.frameId && frameById[target.frameId];
    if (f) {
      const wrap = document.getElementById("stage-wrap");
      wrap.scrollTo({ left: Math.max(0, f.x - minX - 100), top: Math.max(0, f.y - minY - 100) });
    }
  }
}
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
        <tr><td style="color:#a1a1a8">↳ <strong>B · ${escapeHtml(test.variant.label)}</strong></td>${statCells(forVariant("b"))}</tr>`;
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
  body { margin: 0; padding: 40px 24px; background: #101012; color: #e7e7ea;
         font: 15px/1.6 -apple-system, system-ui, sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 12px; }
  h3 { font-size: 14px; margin: 0 0 4px; }
  .sub { color: #a1a1a8; margin: 0 0 8px; }
  .stats { display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap; }
  .stat { background: #18181b; border: 1px solid #2a2a2f; border-radius: 10px; padding: 14px 18px; }
  .stat strong { display: block; font-size: 22px; }
  .stat span { color: #a1a1a8; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: #18181b; border: 1px solid #2a2a2f; border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #2a2a2f; font-size: 13px; }
  th { color: #a1a1a8; font-weight: 500; }
  tr:last-child td { border-bottom: 0; }
  .q { background: #18181b; border: 1px solid #2a2a2f; border-radius: 10px; padding: 16px 18px; margin-bottom: 12px; }
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

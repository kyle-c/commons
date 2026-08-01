import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { agentEventValidator } from "./agentSessions";
import { accessibleProject, resolveViewer } from "./access";
import { normalizeRemote, slugifyBranch } from "./github";
import { installationToken } from "./githubApp";
import { siteUrl } from "./siteUrl";

/**
 * Agents on GitHub Actions (AG-10): sessions that run with nobody's Mac awake.
 *
 * The desktop's agent machinery already splits cleanly into "execute the
 * turn" and "mirror it so the team can watch" (AG-9). A cloud session keeps
 * the second half untouched: it is an ordinary agentSessions row whose events
 * arrive over HTTP instead of IPC, so every existing spectator surface works
 * on it unchanged. What moves off-machine is only execution.
 *
 * The execution vehicle is a GitHub Actions workflow in the user's own repo,
 * for three deliberate reasons:
 * - The credentials live where they already live. ANTHROPIC_API_KEY is a repo
 *   secret; the push credential is the workflow's own GITHUB_TOKEN. Commons
 *   stores neither, which keeps its zero-stored-git-credentials stance.
 * - The repo owner can read every line the runner executes, kill a run from
 *   the Actions tab, and revoke the whole capability by deleting one file.
 * - Actions minutes are billed to the org that owns the repo, not to Commons.
 *
 * Commons cannot install the workflow itself: the GitHub App deliberately
 * lacks the `workflows` permission (an App that can rewrite CI is a much
 * bigger grant than one that can read deploys). So setup is two explicit
 * human steps, surfaced with copy buttons: commit the workflow file, add the
 * secret. After that, dispatch is one click.
 *
 * The runner script is fetched from Commons at run time rather than baked
 * into the workflow, so fixes ship without touching anyone's repo. The
 * workflow pins what matters (checkout, node); the script stays ours.
 */

const RUN_TOKEN_BYTES = 24;

function randomRunToken(): string {
  const bytes = new Uint8Array(RUN_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** owner/repo out of any remote shape we accept, or null. */
function repoFullName(gitRemote: string): string | null {
  const normalized = normalizeRemote(gitRemote);
  const match = normalized.match(/github\.com\/([^/]+\/[^/]+)$/);
  return match ? match[1] : null;
}

/**
 * Start a cloud session: create the mirror row, then dispatch the workflow.
 *
 * The mutation returns as soon as the row exists, so the panel can open the
 * transcript immediately; the dispatch itself runs as a follow-up action
 * (mutations cannot fetch). If the repo has no workflow installed, GitHub
 * still answers 204 (repository_dispatch is fire-and-forget), so "nothing
 * ever arrived" is a state the UI has to name rather than an error we can
 * catch here. sessionStatus below exists for exactly that.
 */
export const dispatch = mutation({
  args: {
    projectId: v.id("projects"),
    prompt: v.string(),
    title: v.string(),
    threadId: v.optional(v.id("threads")),
    frameId: v.optional(v.id("frames")),
    routePath: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const project = viewerId ? await accessibleProject(ctx, args.projectId, viewerId) : null;
    if (!project || !viewerId) throw new Error("You don't have access to this project.");
    if (!project.gitRemote) throw new Error("Cloud agents need a GitHub repository connected to the project.");
    const fullName = repoFullName(project.gitRemote);
    if (!fullName) throw new Error("The project's git remote doesn't look like a GitHub repository.");

    const slug = slugifyBranch(args.title).slice(0, 40) || "draft";
    const runToken = randomRunToken();
    const branch = `commons/${slug}-${runToken.slice(0, 4)}`;

    const sessionId = await ctx.db.insert("agentSessions", {
      projectId: args.projectId,
      hostUserId: viewerId,
      adapter: "claude-code",
      title: args.title,
      status: "starting",
      threadId: args.threadId,
      frameId: args.frameId,
      routePath: args.routePath,
      editedFiles: [],
      runner: "actions",
      runToken,
      branch,
    });
    await ctx.db.insert("agentEvents", {
      sessionId,
      event: { type: "prompt", text: args.prompt },
    });

    await ctx.scheduler.runAfter(0, internal.cloudAgents.startWorkflow, {
      sessionId,
      projectId: args.projectId,
      fullName,
      prompt: args.prompt,
      title: args.title,
      branch,
      runToken,
    });
    return { sessionId, branch };
  },
});

/** Find the installation that can see this repo, then fire the dispatch. */
export const startWorkflow = internalAction({
  args: {
    sessionId: v.id("agentSessions"),
    projectId: v.id("projects"),
    fullName: v.string(),
    prompt: v.string(),
    title: v.string(),
    branch: v.string(),
    runToken: v.string(),
  },
  handler: async (ctx, args) => {
    const installationId = await ctx.runQuery(internal.cloudAgents.installationForProject, {
      projectId: args.projectId,
      fullName: args.fullName,
    });
    if (!installationId) {
      await ctx.runMutation(internal.cloudAgents.markFailed, {
        sessionId: args.sessionId,
        runToken: args.runToken,
        error:
          "No GitHub installation can reach this repository. Connect GitHub for this workspace and include the repo.",
      });
      return null;
    }
    try {
      const token = await installationToken(installationId);
      const response = await fetch(`https://api.github.com/repos/${args.fullName}/dispatches`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: "commons-agent",
          client_payload: {
            sessionId: args.sessionId,
            runToken: args.runToken,
            prompt: args.prompt,
            title: args.title,
            branch: args.branch,
            callback: siteUrl(),
          },
        }),
      });
      if (response.status !== 204) {
        await ctx.runMutation(internal.cloudAgents.markFailed, {
          sessionId: args.sessionId,
          runToken: args.runToken,
          error:
            response.status === 403
              ? "GitHub refused the dispatch: the App's \"contents\" permission is read-only, and cloud runs need " +
                "read and write. Raise it in the App's settings, approve it on the installation, then try again."
              : `GitHub refused the dispatch (${response.status}). ${(await response.text()).slice(0, 200)}`,
        });
      }
    } catch (error) {
      await ctx.runMutation(internal.cloudAgents.markFailed, {
        sessionId: args.sessionId,
        runToken: args.runToken,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  },
});

export const installationForProject = internalQuery({
  args: { projectId: v.id("projects"), fullName: v.string() },
  handler: async (ctx, { projectId, fullName }) => {
    const project = await ctx.db.get(projectId);
    if (!project?.workspaceId) return null;
    const links = await ctx.db
      .query("githubWorkspaceLinks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", project.workspaceId!))
      .collect();
    for (const link of links) {
      const row = await ctx.db
        .query("githubInstallations")
        .withIndex("by_installation", (q) => q.eq("installationId", link.installationId))
        .first();
      if (!row || row.removedAt) continue;
      if ((row.repositories ?? []).some((full) => full.toLowerCase() === fullName.toLowerCase())) {
        return row.installationId;
      }
    }
    return null;
  },
});

/**
 * The remote runner's write path. The run token is the whole credential:
 * knowing it proves the caller is the run this session dispatched, because it
 * has existed only in the dispatch payload GitHub delivered to the repo's own
 * workflow. Constant-time comparison is unnecessary here (single-use, high
 * entropy, no oracle), but scope discipline matters: a token writes to its
 * one session and nothing else.
 */
export const ingestEvent = internalMutation({
  args: { sessionId: v.id("agentSessions"), runToken: v.string(), event: agentEventValidator },
  handler: async (ctx, { sessionId, runToken, event }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.runner !== "actions" || session.runToken !== runToken) return { ok: false };
    await ctx.db.insert("agentEvents", { sessionId, event });
    if (session.status === "starting") await ctx.db.patch(sessionId, { status: "running" });
    return { ok: true };
  },
});

export const finishRun = internalMutation({
  args: {
    sessionId: v.id("agentSessions"),
    runToken: v.string(),
    ok: v.boolean(),
    summary: v.string(),
    editedFiles: v.array(v.string()),
    numTurns: v.number(),
    durationMs: v.number(),
    totalCostUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.runner !== "actions" || session.runToken !== args.runToken) return { ok: false };
    await ctx.db.insert("agentEvents", {
      sessionId: args.sessionId,
      event: {
        type: "result",
        ok: args.ok,
        summary: args.summary,
        numTurns: args.numTurns,
        durationMs: args.durationMs,
        totalCostUsd: args.totalCostUsd,
        editedFiles: args.editedFiles,
        draft: session.branch ? { branch: session.branch } : undefined,
      },
    });
    await ctx.db.patch(args.sessionId, {
      status: args.ok ? "idle" : "error",
      editedFiles: args.editedFiles,
      error: args.ok ? undefined : args.summary,
    });
    return { ok: true };
  },
});

export const markFailed = internalMutation({
  args: { sessionId: v.id("agentSessions"), runToken: v.string(), error: v.string() },
  handler: async (ctx, { sessionId, runToken, error }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.runner !== "actions" || session.runToken !== runToken) return null;
    await ctx.db.insert("agentEvents", { sessionId, event: { type: "status", status: "error", error } });
    await ctx.db.patch(sessionId, { status: "error", error });
    return null;
  },
});

/**
 * "Did anything actually start?" — rendered by the panel, so it degrades.
 *
 * repository_dispatch cannot fail visibly (GitHub answers 204 into the void),
 * so a repo without the workflow file produces a session that sits in
 * "starting" forever. The UI turns that silence into setup instructions
 * after a grace period; this query is how it tells the states apart.
 */
export const sessionStatus = query({
  args: {
    sessionId: v.id("agentSessions"),
    userId: v.optional(v.id("users")),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveViewer(ctx, args);
    const session = await ctx.db.get(args.sessionId);
    if (!session || !viewerId) return null;
    const project = await accessibleProject(ctx, session.projectId, viewerId);
    if (!project) return null;
    return {
      status: session.status,
      runner: session.runner ?? null,
      branch: session.branch ?? null,
      error: session.error ?? null,
      startedAt: session._creationTime,
    };
  },
});

// ── What the user installs (served by http.ts, shown with copy buttons) ─────

export const WORKFLOW_FILE = `name: Commons Agent
on:
  repository_dispatch:
    types: [commons-agent]

# The workflow's own token pushes the draft branch; nothing of yours leaves
# the repo. ANTHROPIC_API_KEY is the one secret you add.
permissions:
  contents: write

jobs:
  agent:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run the Commons agent
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          COMMONS_PAYLOAD: \${{ toJson(github.event.client_payload) }}
        run: |
          mkdir -p /tmp/commons && cd /tmp/commons
          npm init -y >/dev/null 2>&1
          npm install --no-fund --no-audit @anthropic-ai/claude-agent-sdk >/dev/null 2>&1
          CALLBACK=$(node -e 'console.log(JSON.parse(process.env.COMMONS_PAYLOAD).callback)')
          curl -fsSL "$CALLBACK/setup/agent-runner.mjs" -o runner.mjs
          cd "$GITHUB_WORKSPACE"
          NODE_PATH=/tmp/commons/node_modules node /tmp/commons/runner.mjs
`;

export const RUNNER_SCRIPT = `// Commons cloud agent runner. Fetched fresh from Commons at run time, so
// fixes ship without touching your repo. Everything it does is visible in
// the Actions log; everything it pushes lands on a commons/* branch.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/tmp/commons/");
const { query } = require("@anthropic-ai/claude-agent-sdk");

const payload = JSON.parse(process.env.COMMONS_PAYLOAD);

// Flow v2: a crawl reuses this same workflow/event. Hand off to the browser
// crawler (fetched fresh from Commons) and exit; the code-agent path below
// only runs for ordinary agent dispatches.
if (payload.mode === "crawl") {
  // Playwright isn't in the agent runner's deps; install it and its browser
  // just for the crawl. Then require chromium and hand it to the fetched
  // crawler, so the crawler never resolves a bare specifier of its own.
  execFileSync("npm", ["install", "--no-fund", "--no-audit", "playwright"], { cwd: "/tmp/commons", stdio: "inherit" });
  execFileSync("npx", ["playwright", "install", "--with-deps", "chromium"], { cwd: "/tmp/commons", stdio: "inherit" });
  const { chromium } = require("playwright");
  const res = await fetch(payload.callback + "/setup/flow-crawler.mjs");
  writeFileSync("/tmp/commons/flow-crawler.mjs", await res.text());
  const { runCrawl } = await import("/tmp/commons/flow-crawler.mjs");
  await runCrawl(payload, chromium);
  process.exit(0);
}

const { sessionId, runToken, prompt, branch, callback } = payload;
const COST_CEILING_USD = 5; // same guardrail as the desktop (AG-7)

async function post(path, body) {
  try {
    await fetch(callback + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, runToken, ...body }),
    });
  } catch {
    // Mirroring is best-effort; the run itself must not die on a blip.
  }
}
const emit = (event) => post("/api/agent/event", { event });

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const startedAt = Date.now();
git(["config", "user.name", "Commons Agent"]);
git(["config", "user.email", "agent@trycommons.app"]);
git(["checkout", "-b", branch]);
await emit({ type: "status", status: "running" });

let summary = "";
let numTurns = 0;
let totalCostUsd;
let ok = false;
try {
  for await (const message of query({
    prompt,
    options: { cwd: process.cwd(), permissionMode: "acceptEdits", maxTurns: 40 },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content ?? []) {
        if (block.type === "text" && block.text.trim()) {
          summary = block.text;
          await emit({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          await emit({
            type: "tool",
            toolUseId: block.id,
            name: block.name,
            summary: typeof block.input?.file_path === "string" ? block.input.file_path : block.name,
            filePath: typeof block.input?.file_path === "string" ? block.input.file_path : undefined,
          });
        }
      }
    } else if (message.type === "result") {
      numTurns = message.num_turns ?? 0;
      totalCostUsd = message.total_cost_usd;
      ok = message.subtype === "success";
      if (ok && message.result) summary = message.result;
      if ((message.total_cost_usd ?? 0) > COST_CEILING_USD) {
        summary = "Stopped at the $" + COST_CEILING_USD + " ceiling. " + summary;
      }
    }
  }
} catch (error) {
  summary = String(error && error.message ? error.message : error);
  ok = false;
}

const changed = git(["status", "--porcelain"])
  .split("\\n")
  .filter(Boolean)
  .map((line) => line.slice(3));
if (ok && changed.length > 0) {
  git(["add", "-A"]);
  git(["commit", "-m", payload.title + "\\n\\nDrafted by the Commons agent from a comment thread."]);
  git(["push", "-u", "origin", branch]);
}

await post("/api/agent/done", {
  ok,
  summary: summary || (ok ? "Done." : "The run produced no result."),
  editedFiles: changed,
  numTurns,
  durationMs: Date.now() - startedAt,
  totalCostUsd,
});
`;

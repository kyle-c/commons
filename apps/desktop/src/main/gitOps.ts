import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Git plumbing for ambient-git features. All operations shell out to the
 * system git via the user's credential helpers (Commons never stores git
 * credentials). Guardrails: never touch a dirty tree, never merge/rebase —
 * only fast-forward pulls and Commons-owned draft branches.
 */

function git(
  cwd: string,
  args: string[],
  opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: opts.timeout ?? 120_000, env: opts.env ?? process.env },
      (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: stdout.trim(), stderr: stderr.trim() });
      }
    );
  });
}

export interface GitRepoStatus {
  branch: string;
  dirty: boolean;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
}

// Fetch at most once a minute per repo — status polls shouldn't hammer the remote.
const lastFetch = new Map<string, number>();

async function maybeFetch(repoPath: string): Promise<void> {
  const last = lastFetch.get(repoPath) ?? 0;
  if (Date.now() - last < 60_000) return;
  lastFetch.set(repoPath, Date.now());
  await git(repoPath, ["fetch", "--quiet"]); // offline is fine — counts just go stale
}

export async function status(repoPath: string): Promise<GitRepoStatus | null> {
  const branch = await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch.ok) return null;
  await maybeFetch(repoPath);
  const porcelain = await git(repoPath, ["status", "--porcelain"]);
  const upstream = await git(repoPath, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  let ahead = 0;
  let behind = 0;
  if (upstream.ok) {
    const counts = await git(repoPath, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
    if (counts.ok) {
      const [left, right] = counts.stdout.split(/\s+/).map((n) => parseInt(n, 10) || 0);
      behind = left;
      ahead = right;
    }
  }
  return {
    branch: branch.stdout,
    dirty: porcelain.ok && porcelain.stdout.length > 0,
    hasUpstream: upstream.ok,
    ahead,
    behind,
  };
}

/** Fast-forward-only pull; refuses dirty trees. The only pull Commons ever runs. */
export async function pullFastForward(repoPath: string): Promise<{ ok: boolean; message: string }> {
  const porcelain = await git(repoPath, ["status", "--porcelain"]);
  if (!porcelain.ok) return { ok: false, message: "Not a git repository." };
  if (porcelain.stdout.length > 0) {
    return { ok: false, message: "Local changes present — pull skipped to protect them." };
  }
  const pull = await git(repoPath, ["pull", "--ff-only"]);
  return pull.ok
    ? { ok: true, message: pull.stdout || "Up to date." }
    : { ok: false, message: pull.stderr || "Pull failed." };
}

export async function clone(gitRemote: string, targetDir: string): Promise<{ ok: boolean; message: string }> {
  const parent = path.dirname(targetDir);
  const result = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
    execFile(
      "git",
      ["clone", gitRemote, targetDir],
      { cwd: parent, timeout: 600_000, env: process.env },
      (error, _stdout, stderr) => resolve({ ok: !error, stderr: stderr.trim() })
    );
  });
  return result.ok ? { ok: true, message: targetDir } : { ok: false, message: result.stderr || "Clone failed." };
}

/**
 * Commons-managed checkout for draft agent sessions: a clone owned by the app
 * (under userData/checkouts) so sessions never touch anyone's working tree —
 * and so teammates without their own clone can host sessions at all.
 */
export async function ensureCheckout(gitRemote: string, checkoutsRoot: string): Promise<string> {
  const name = (gitRemote.split("/").pop() ?? "repo").replace(/\.git$/, "").replace(/[^a-zA-Z0-9-_]/g, "-");
  const hash = crypto.createHash("sha1").update(gitRemote).digest("hex").slice(0, 8);
  const dir = path.join(checkoutsRoot, `${name}-${hash}`);
  const hasGit = await fs
    .access(path.join(dir, ".git"))
    .then(() => true)
    .catch(() => false);
  if (hasGit) {
    await git(dir, ["fetch", "--quiet"]);
    return dir;
  }
  await fs.mkdir(checkoutsRoot, { recursive: true });
  const result = await clone(gitRemote, dir);
  if (!result.ok) throw new Error(`Couldn't prepare the draft workspace: ${result.message}`);
  return dir;
}

async function defaultBranch(checkout: string): Promise<string> {
  const head = await git(checkout, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.ok) return head.stdout.replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    const probe = await git(checkout, ["rev-parse", "--verify", `origin/${candidate}`]);
    if (probe.ok) return candidate;
  }
  throw new Error("Couldn't determine the repo's default branch.");
}

/** Fresh Commons-owned branch off the latest default — one per draft session. */
export async function prepareDraftBranch(
  checkout: string,
  slug: string
): Promise<{ branch: string; baseBranch: string }> {
  await git(checkout, ["fetch", "--quiet"]);
  const base = await defaultBranch(checkout);
  const branch = `commons/${slug}-${Date.now().toString(36).slice(-5)}`;
  const checkedOut = await git(checkout, ["checkout", "-B", branch, `origin/${base}`]);
  if (!checkedOut.ok) throw new Error(`Couldn't create draft branch: ${checkedOut.stderr}`);
  await git(checkout, ["reset", "--hard", `origin/${base}`]);
  await git(checkout, ["clean", "-fd"]);
  return { branch, baseBranch: base };
}

export async function commitAndPushDraft(
  checkout: string,
  branch: string,
  message: string
): Promise<{ committed: boolean; pushed: boolean; error?: string }> {
  await git(checkout, ["add", "-A"]);
  const staged = await git(checkout, ["status", "--porcelain"]);
  if (!staged.stdout) return { committed: false, pushed: false };
  const commit = await git(checkout, ["commit", "-m", `${message}\n\nDrafted via Commons agent session.`]);
  if (!commit.ok) return { committed: false, pushed: false, error: commit.stderr };
  const push = await git(checkout, ["push", "-u", "origin", branch]);
  return push.ok
    ? { committed: true, pushed: true }
    : { committed: true, pushed: false, error: push.stderr || "Push failed (check git credentials)." };
}

export interface GitSetupStatus {
  gitInstalled: boolean;
  identityName?: string;
  identityEmail?: string;
  /** Can we actually reach + authenticate against a team remote? */
  remoteAccess: "ok" | "auth_failed" | "unreachable" | "skipped";
}

/**
 * Onboarding preflight: checks the three things that make clone/draft/push
 * fail for new users — git itself, a commit identity, and remote credentials.
 * The remote probe runs with terminal prompts disabled so a missing credential
 * fails cleanly instead of hanging on an invisible password prompt.
 */
export async function checkSetup(probeRemote?: string): Promise<GitSetupStatus> {
  const home = process.env.HOME ?? "/";
  const version = await git(home, ["--version"], { timeout: 10_000 });
  if (!version.ok) return { gitInstalled: false, remoteAccess: "skipped" };
  const name = await git(home, ["config", "--global", "user.name"]);
  const email = await git(home, ["config", "--global", "user.email"]);
  let remoteAccess: GitSetupStatus["remoteAccess"] = "skipped";
  if (probeRemote) {
    const probe = await git(home, ["ls-remote", "--heads", probeRemote], {
      timeout: 20_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    remoteAccess = probe.ok
      ? "ok"
      : /auth|denied|401|403|username|password|credential/i.test(probe.stderr)
        ? "auth_failed"
        : "unreachable";
  }
  return {
    gitInstalled: true,
    identityName: name.stdout || undefined,
    identityEmail: email.stdout || undefined,
    remoteAccess,
  };
}

/** One-click identity fix — Commons already knows the user's name and email. */
export async function setIdentity(name: string, email: string): Promise<{ ok: boolean; message: string }> {
  const home = process.env.HOME ?? "/";
  const setName = await git(home, ["config", "--global", "user.name", name]);
  const setEmail = await git(home, ["config", "--global", "user.email", email]);
  return setName.ok && setEmail.ok
    ? { ok: true, message: "Git identity configured." }
    : { ok: false, message: setName.stderr || setEmail.stderr || "Couldn't write git config." };
}

/** GitHub compare/PR page for a draft branch, when the remote is GitHub. */
export function compareUrl(gitRemote: string, baseBranch: string, branch: string): string | undefined {
  const match =
    gitRemote.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/) ??
    gitRemote.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return undefined;
  return `https://github.com/${match[1]}/${match[2]}/compare/${baseBranch}...${encodeURIComponent(branch)}?expand=1`;
}

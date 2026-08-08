import { execFile } from "child_process";
import type { GitRepoStatus, GitSetupStatus, PendingFile } from "@commons/shared";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Git plumbing for ambient-git features. All operations shell out to the
 * system git via the user's credential helpers (Commons never stores git
 * credentials). Guardrails: never touch a dirty tree, never merge/rebase —
 * only fast-forward pulls and Commons-owned draft branches.
 */

/**
 * A git remote from a project doc is collaborator-writable (`setGitRemote`
 * validates it only as a string) and flows straight into `git clone` and
 * `git ls-remote`. git's transport helpers turn that into remote code
 * execution on the host: `ext::sh -c "<cmd>"` runs the string in a shell, and
 * a value starting with `-` is parsed as a git option (argument injection).
 * The ls-remote probe even fires on project-list render, so this is
 * near-zero-click. Allow only the real remote shapes and reject the rest;
 * callers also pass `--` before the remote as belt-and-braces.
 */
export function isSafeGitRemote(remote: string): boolean {
  if (typeof remote !== "string" || remote.length === 0 || remote.length > 2048) return false;
  if (remote.startsWith("-")) return false; // never an option
  if (/[\x00-\x1f]/.test(remote)) return false; // no control chars / newlines
  if (remote.includes("::")) return false; // ext::/transport helpers = RCE
  // https://…, http://…, ssh://…, git://…, or scp-like user@host:path.
  return (
    /^https?:\/\/\S+$/i.test(remote) ||
    /^(ssh|git):\/\/\S+$/i.test(remote) ||
    /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:\S+$/.test(remote)
  );
}

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


const RISKY_PATH =
  /(^|\/)(\.env(\.|$)|.*\.pem$|.*\.p8$|.*\.key$|.*\.pfx$|id_rsa|id_ed25519|.*\.keystore$|secrets?\.(json|ya?ml|toml))/i;

function describeCode(code: string): string {
  if (code === "??") return "new";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code.includes("A")) return "added";
  return "changed";
}

export async function pendingChanges(repoPath: string): Promise<{ ok: boolean; files: PendingFile[] }> {
  const porcelain = await git(repoPath, ["status", "--porcelain=v1", "-uall"]);
  if (!porcelain.ok) return { ok: false, files: [] };
  const files = porcelain.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      // Git quotes paths containing unusual bytes; unwrap so the list reads
      // like filenames rather than like escaping.
      const path = line.slice(3).replace(/^"(.*)"$/, "$1");
      return { path, state: describeCode(line.slice(0, 2)), risky: RISKY_PATH.test(path) };
    });
  return { ok: true, files };
}

/**
 * Get local work onto origin, which is the thing that actually makes a
 * preview update.
 *
 * Named for its outcome rather than its plumbing, and deliberately the only
 * write Commons performs on a repo you own: it commits (all of it, once you
 * have seen the list), and it pushes the current branch. It will not merge,
 * rebase, or switch branches — those need judgement Commons does not have, and
 * anyone who wants them has better tools already.
 */
export async function publish(repoPath: string, message?: string): Promise<{ ok: boolean; message: string }> {
  const current = await status(repoPath);
  if (!current) return { ok: false, message: "Not a git repository." };

  // Pushing onto a branch that has moved would be rejected anyway, and the fix
  // is a merge or rebase decision Commons refuses to make on your behalf.
  if (current.behind > 0 && (current.dirty || current.ahead > 0)) {
    return {
      ok: false,
      message:
        `Origin has ${current.behind} commit${current.behind === 1 ? "" : "s"} you don't have yet, so this push would be rejected. ` +
        "Pull first, or sort it out in a git client — Commons won't merge or rebase for you.",
    };
  }

  if (current.dirty) {
    if (!message?.trim()) return { ok: false, message: "A commit needs a message." };
    const staged = await git(repoPath, ["add", "-A"]);
    if (!staged.ok) return { ok: false, message: staged.stderr || "Could not stage the changes." };
    const commit = await git(repoPath, ["commit", "-m", message.trim()]);
    if (!commit.ok) return { ok: false, message: commit.stderr || commit.stdout || "Commit failed." };
  } else if (current.ahead === 0) {
    return { ok: true, message: "Nothing to publish — origin already has everything." };
  }

  const pushed = current.hasUpstream
    ? await git(repoPath, ["push"])
    : await git(repoPath, ["push", "-u", "origin", "HEAD"]);
  if (!pushed.ok) return { ok: false, message: pushed.stderr || "Push failed." };
  return {
    ok: true,
    message: `Pushed to ${current.branch}. Your host builds from here, and the preview link updates once that deploy goes green.`,
  };
}

/** The origin remote of the repo containing dir, if any (nested dirs count). */
export async function originOf(dir: string): Promise<string | null> {
  const result = await git(dir, ["config", "--get", "remote.origin.url"]);
  return result.ok && result.stdout ? result.stdout : null;
}

/** Whether dir sits anywhere inside a git working tree. */
export async function insideRepo(dir: string): Promise<boolean> {
  const result = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.stdout === "true";
}

export async function clone(gitRemote: string, targetDir: string): Promise<{ ok: boolean; message: string }> {
  if (!isSafeGitRemote(gitRemote)) {
    return { ok: false, message: "That git remote isn't a supported URL (expected https://, ssh://, or git@host:path)." };
  }
  const parent = path.dirname(targetDir);
  const result = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
    execFile(
      "git",
      ["clone", "--", gitRemote, targetDir],
      { cwd: parent, timeout: 600_000, env: process.env },
      (error, _stdout, stderr) => resolve({ ok: !error, stderr: stderr.trim() })
    );
  });
  if (result.ok) return { ok: true, message: targetDir };
  // Translate git's cryptic failures into the actual remedy. GitHub answers
  // "not found" for private repos the machine isn't signed in to — the most
  // common failure on a fresh laptop, since Commons never stores credentials.
  const stderr = result.stderr || "Clone failed.";
  if (/repository .*not found|could not read Username|Authentication failed|Permission denied/i.test(stderr)) {
    return {
      ok: false,
      message:
        "GitHub can't see this repo from this machine — if it's private, this laptop's git isn't signed in yet. " +
        "Run `gh auth login` in a terminal (or clone anything once so git saves credentials), then try Get the code again.",
    };
  }
  return { ok: false, message: stderr };
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


/**
 * Onboarding preflight: checks the three things that make clone/draft/push
 * fail for new users — git itself, a commit identity, and remote credentials.
 * The remote probe runs with terminal prompts disabled so a missing credential
 * fails cleanly instead of hanging on an invisible password prompt.
 */
/**
 * Would this draft branch merge into its base cleanly, and if not, which files
 * disagree?
 *
 * Uses `merge-tree --write-tree`, which resolves the merge entirely in the
 * object database and never touches the index or the working tree. That
 * matters: the guardrail is that Commons never disturbs a dirty tree, and a
 * conflict check that ran `git merge` would violate it precisely when the
 * answer is "there is a conflict".
 *
 * Requires git 2.38. Older git reports "unsupported" rather than guessing,
 * because claiming a clean merge we could not verify is the one answer that
 * would cause harm.
 */
export async function mergePreview(
  repoPath: string,
  draftBranch: string,
  baseBranch: string
): Promise<{ supported: boolean; clean: boolean; conflicts: string[] }> {
  await maybeFetch(repoPath);
  const probe = await git(repoPath, ["merge-tree", "--write-tree", "--name-only", baseBranch, draftBranch]);
  // Unknown option / unknown revision: we cannot answer, so say so.
  if (!probe.ok && !/CONFLICT|Auto-merging/i.test(probe.stdout + probe.stderr)) {
    return { supported: false, clean: false, conflicts: [] };
  }
  if (probe.ok) return { supported: true, clean: true, conflicts: [] };

  // Conflict output is: tree oid, then one conflicted path per line, then a
  // blank line and human-readable notes we don't need.
  const [block = ""] = probe.stdout.split("\n\n");
  const conflicts = block
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
  return { supported: true, clean: false, conflicts };
}

export async function checkSetup(probeRemote?: string): Promise<GitSetupStatus> {
  const home = process.env.HOME ?? "/";
  const version = await git(home, ["--version"], { timeout: 10_000 });
  if (!version.ok) return { gitInstalled: false, remoteAccess: "skipped" };
  const name = await git(home, ["config", "--global", "user.name"]);
  const email = await git(home, ["config", "--global", "user.email"]);
  let remoteAccess: GitSetupStatus["remoteAccess"] = "skipped";
  if (probeRemote && isSafeGitRemote(probeRemote)) {
    const probe = await git(home, ["ls-remote", "--heads", "--", probeRemote], {
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

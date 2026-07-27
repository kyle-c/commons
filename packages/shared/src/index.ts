/** A route discovered in a local Next.js project. */
export interface DiscoveredRoute {
  /** URL path, e.g. "/", "/settings/profile". Dynamic segments keep brackets: "/posts/[id]". */
  path: string;
  /** Source file relative to the repo root. */
  file: string;
  /** Display title override (commons.json); derived from the path otherwise. */
  title?: string;
  /** True if the path contains dynamic segments and needs sample params before it can render. */
  dynamic: boolean;
  /**
   * IA grouping for canvas layout: an explicit router group name ("(tabs)" →
   * "Tabs") when the route lives in one, else the first URL segment when at
   * least two routes share it. Undefined = ungrouped.
   */
  section?: string;
}

/** Result of pointing Commons at a local repo. */
export interface RepoInspection {
  repoPath: string;
  name: string;
  framework: "nextjs" | "expo" | "vite" | "custom" | "unknown";
  /** Frame size from commons.json (defaults: expo 390×844, web 1280×800). */
  device?: { width: number; height: number };
  packageManager: "pnpm" | "yarn" | "npm" | "bun";
  routes: DiscoveredRoute[];
  /** origin URL — the canonical identity a working copy maps to. */
  gitRemote?: string;
  /** Two most prominent brand colors found in the repo's stylesheets. */
  brandColors?: string[];
}

/** Status of the dev server Commons runs for a project. */
export type DevServerStatus =
  | { state: "stopped" }
  | { state: "starting"; port: number }
  | { state: "ready"; port: number; url: string }
  | { state: "error"; message: string };

/** Payload of a parsed commons:// deep link. */
export interface DeepLink {
  projectId: string;
  view: "canvas" | "prototype";
  frameId?: string;
  threadId?: string;
}

/** Which coding agent backs a session. Codex CLI et al. slot in as new adapter kinds. */
export type AgentAdapterKind = "claude-code";

export type AgentSessionStatus =
  | "starting"
  | "running"
  | "idle" // finished a turn, can take a follow-up prompt
  | "error"
  | "stopped";

/** What the session was started from — lets the renderer refresh the right frame. */
export interface AgentSessionContext {
  projectId?: string;
  threadId?: string;
  frameId?: string;
  /** Route of the frame the work targets, e.g. "/settings". */
  routePath?: string;
  /** Convex agentSessions doc id this session mirrors into (set by the host renderer). */
  mirrorSessionId?: string;
}

export interface AgentStartOptions {
  /** Run in this working tree (classic in-place mode). */
  repoPath?: string;
  /**
   * Draft mode: run in a Commons-managed checkout of this remote, on a fresh
   * commons/<slug> branch, committing + pushing on success. Takes precedence
   * over repoPath; lets teammates without a working copy host sessions.
   */
  gitRemote?: string;
  /** Branch slug for draft mode, e.g. "fix-savings-header". */
  draftSlug?: string;
  /** "{branch}"-templated URL for per-branch deploy previews (PRJ-14). */
  branchPreviewPattern?: string;
  prompt: string;
  /** Short label shown in the session list, e.g. the first line of the thread. */
  title: string;
  adapter?: AgentAdapterKind;
  context?: AgentSessionContext;
}

/** Attached to a result event when the session ran in draft mode. */
export interface AgentDraftInfo {
  branch: string;
  baseBranch: string;
  committed: boolean;
  pushed: boolean;
  /** GitHub compare/PR page ("Ship it") when the remote is GitHub. */
  compareUrl?: string;
  /** Deployed preview of the draft branch (from the project's branchPreviewPattern). */
  previewUrl?: string;
  pushError?: string;
}

/**
 * Resolve a draft branch's deploy-preview URL from a project pattern like
 * "https://myapp-git-{branch}-team.vercel.app". The branch is slugified the
 * way Vercel does (non-alphanumerics → dashes): commons/fix-nav → commons-fix-nav.
 */
export function draftPreviewUrl(pattern: string, branch: string): string {
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return pattern.replace("{branch}", slug).replace(/\/+$/, "");
}

export interface AgentSessionInfo {
  sessionId: string;
  adapter: AgentAdapterKind;
  repoPath: string;
  title: string;
  status: AgentSessionStatus;
  createdAt: number;
  context: AgentSessionContext;
  /** Repo-relative paths the agent has edited so far. */
  editedFiles: string[];
  error?: string;
}

/** Streamed to the renderer as a session runs; the panel renders these in order. */
export type AgentSessionEvent =
  | { type: "status"; status: AgentSessionStatus; error?: string }
  | { type: "prompt"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; toolUseId: string; name: string; summary: string; filePath?: string }
  | { type: "tool-result"; toolUseId: string; isError: boolean }
  | {
      type: "result";
      ok: boolean;
      summary: string;
      durationMs: number;
      numTurns: number;
      totalCostUsd?: number;
      editedFiles: string[];
      draft?: AgentDraftInfo;
    };

/** One citation on an annotation claim (NAR). Empty citations = inferred. */
export interface AnnotationCitation {
  kind: "commit" | "doc" | "code" | "thread" | "test";
  ref: string;
  /** Set by the mechanical post-pass (commit hash exists, path exists, id known). */
  verified?: boolean;
}

/** A generated annotation draft, before curation. */
export interface AnnotationDraft {
  /** Screen-level: matches a canvas frame by title. */
  frameTitle?: string;
  /** Flow-level: a named flow instead of a single screen. */
  flowTitle?: string;
  text: string;
  citations: AnnotationCitation[];
}

/** Commons-native evidence the renderer hands the generator to mine + cite. */
export interface AnnotationEvidence {
  threads: { id: string; frameTitle?: string; summary: string }[];
  tests: { id: string; summary: string }[];
}

export interface AnnotationGenerateRequest {
  repoPath: string;
  projectName: string;
  /** Screens to annotate — canvas frames (title + route). */
  frames: { title: string; routePath?: string }[];
  evidence?: AnnotationEvidence;
}

export interface AnnotationGenerateResult {
  ok: boolean;
  drafts: AnnotationDraft[];
  confidenceNotes?: string;
  costUsd?: number;
  error?: string;
}

/** Local git state of a linked working copy (drift visibility). */
export interface GitRepoStatus {
  branch: string;
  dirty: boolean;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
}

/** Onboarding preflight for the git integration. */
export interface GitSetupStatus {
  gitInstalled: boolean;
  identityName?: string;
  identityEmail?: string;
  remoteAccess: "ok" | "auth_failed" | "unreachable" | "skipped";
}

/** Auto-update state relayed to the renderer ("ready" shows the restart chip). */
export type UpdateStatus = { state: "none" } | { state: "ready"; version: string };

/** Payload of the commons:// callback that ends a system-browser OAuth flow. */
export interface AuthCallback {
  /** The OAuth `state` the app started the flow with. */
  state: string;
}

/**
 * A native menu bar command relayed to the renderer. The menu is the
 * discoverability surface for the app's keyboard-first commands; each action
 * mirrors something the renderer already knows how to do.
 */
export type MenuAction =
  | { type: "new-project" }
  | { type: "open-project"; projectId: string }
  | { type: "set-view"; view: "canvas" | "prototype" }
  | { type: "zoom"; dir: "in" | "out" | "fit" }
  | { type: "shortcuts" }
  | { type: "settings" };

/** IPC surface exposed to the renderer as window.commons. */
export interface CommonsApi {
  pickRepo(): Promise<RepoInspection | null>;
  inspectRepo(repoPath: string): Promise<RepoInspection>;
  startDevServer(repoPath: string, name?: string): Promise<DevServerStatus>;
  /** Port viewer: every dev server this app instance owns. */
  listDevServers(): Promise<{ repoPath: string; name?: string; status: DevServerStatus }[]>;
  /** Servers OTHER tools started (terminal, Claude Code) whose cwd is inside
   *  one of these repos — duplicate-port awareness. macOS only; read-only. */
  detectExternalServers(repoPaths: string[]): Promise<{ repoPath: string; port: number; pid: number }[]>;
  stopDevServer(repoPath: string): Promise<void>;
  /** Leaving a project: stop its dev server after a grace period (reopening cancels). */
  releaseDevServer(repoPath: string): Promise<void>;
  getDevServerStatus(repoPath: string): Promise<DevServerStatus>;
  onDevServerStatus(cb: (repoPath: string, status: DevServerStatus) => void): () => void;
  onDeepLink(cb: (link: DeepLink) => void): () => void;
  onAuthCallback(cb: (auth: AuthCallback) => void): () => void;
  /** Native menu bar commands (File > New Project, View > Canvas, …). */
  onMenuAction(cb: (action: MenuAction) => void): () => void;
  /**
   * The appearance embedded previews render with (canvas frames + Prototype
   * view). Drives Chromium's prefers-color-scheme via nativeTheme, so
   * useColorScheme()-style app code sees it; Commons's own chrome is token-
   * driven and unaffected.
   */
  setPreviewAppearance(mode: "light" | "dark" | "system"): Promise<void>;
  /** Feed the File > Open Recent submenu (renderer owns the recents list). */
  setMenuRecents(recents: { id: string; name: string }[]): void;
  openExternal(url: string): Promise<void>;
  /** Wrap a localhost dev URL in the device-sized preview harness page. */
  wrapPreviewUrl(url: string, opts: { width: number; height: number; title?: string }): Promise<string>;
  /** Local git state of a working copy; null if not a git repo. */
  getGitStatus(repoPath: string): Promise<GitRepoStatus | null>;
  /** Fast-forward-only pull; refuses dirty trees. */
  pullRepo(repoPath: string): Promise<{ ok: boolean; message: string }>;
  /** Clone gitRemote into a user-chosen folder; null if the picker is cancelled. */
  cloneRepo(gitRemote: string, suggestedName: string): Promise<{ repoPath: string } | { error: string } | null>;
  /** Preflight the git integration (install, identity, remote credentials). */
  checkGitSetup(probeRemote?: string): Promise<GitSetupStatus>;
  /** Write global git user.name/user.email (the one-click identity fix). */
  setGitIdentity(name: string, email: string): Promise<{ ok: boolean; message: string }>;
  /**
   * NAR-1: run an annotation pass against a local working copy (single agent
   * turn on the host's credentials; mines git history + docs + the passed
   * Commons evidence). Long-running — minutes; progress streams via
   * onAnnotatorProgress.
   */
  generateAnnotations(request: AnnotationGenerateRequest): Promise<AnnotationGenerateResult>;
  onAnnotatorProgress(cb: (repoPath: string, summary: string) => void): () => void;
  startAgentSession(options: AgentStartOptions): Promise<AgentSessionInfo>;
  /** Follow-up prompt on an idle session. Rejects while a turn is running. */
  sendAgentPrompt(sessionId: string, prompt: string): Promise<void>;
  stopAgentSession(sessionId: string): Promise<void>;
  listAgentSessions(): Promise<AgentSessionInfo[]>;
  onAgentEvent(cb: (sessionId: string, event: AgentSessionEvent) => void): () => void;
  /**
   * Render a URL offscreen and return a PNG (SNAP-1). waitForDeploy first
   * polls until the URL serves 200 (draft previews build after the push) —
   * the returned promise can take minutes; null if the deploy never came up.
   */
  captureSnapshot(
    url: string,
    opts: { width: number; height: number; waitForDeploy?: boolean }
  ): Promise<Uint8Array | null>;
  /** Packaged app version ("dev" outside packaged builds) — for error reports. */
  getAppVersion(): Promise<string>;
  /** Stable per-device id — scopes working-copy links to this machine. */
  getMachineId(): Promise<string>;
  /** Main-process crashes forwarded for reporting (renderer owns the reporter). */
  onMainError(cb: (message: string, stack?: string) => void): () => void;
  /** Auto-update: current status (for late subscribers), push events, restart-to-install. */
  getUpdateStatus(): Promise<UpdateStatus>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  installUpdate(): Promise<void>;
}

export const DEEP_LINK_PROTOCOL = "commons";

export function buildDeepLink(link: DeepLink): string {
  const params = new URLSearchParams();
  if (link.frameId) params.set("frame", link.frameId);
  if (link.threadId) params.set("thread", link.threadId);
  const qs = params.toString();
  return `${DEEP_LINK_PROTOCOL}://project/${link.projectId}/${link.view}${qs ? `?${qs}` : ""}`;
}

export function buildAuthCallbackUrl(state: string): string {
  return `${DEEP_LINK_PROTOCOL}://auth/callback?state=${encodeURIComponent(state)}`;
}

export function parseAuthCallback(raw: string): AuthCallback | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${DEEP_LINK_PROTOCOL}:`) return null;
    if (url.host !== "auth" || url.pathname !== "/callback") return null;
    const state = url.searchParams.get("state");
    return state ? { state } : null;
  } catch {
    return null;
  }
}

export function parseDeepLink(raw: string): DeepLink | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${DEEP_LINK_PROTOCOL}:`) return null;
    // commons://project/<id>/<view> — "project" lands in host, rest in pathname.
    if (url.host !== "project") return null;
    const [, projectId, view] = url.pathname.split("/");
    if (!projectId || (view !== "canvas" && view !== "prototype")) return null;
    return {
      projectId,
      view,
      frameId: url.searchParams.get("frame") ?? undefined,
      threadId: url.searchParams.get("thread") ?? undefined,
    };
  } catch {
    return null;
  }
}

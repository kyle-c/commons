/** A route discovered in a local Next.js project. */
export interface DiscoveredRoute {
  /** URL path, e.g. "/", "/settings/profile". Dynamic segments keep brackets: "/posts/[id]". */
  path: string;
  /** Source file relative to the repo root. */
  file: string;
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
  framework: "nextjs" | "expo" | "unknown";
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
  repoPath: string;
  prompt: string;
  /** Short label shown in the session list, e.g. the first line of the thread. */
  title: string;
  adapter?: AgentAdapterKind;
  context?: AgentSessionContext;
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
    };

/** Payload of the commons:// callback that ends a system-browser OAuth flow. */
export interface AuthCallback {
  /** The OAuth `state` the app started the flow with. */
  state: string;
}

/** IPC surface exposed to the renderer as window.commons. */
export interface CommonsApi {
  pickRepo(): Promise<RepoInspection | null>;
  inspectRepo(repoPath: string): Promise<RepoInspection>;
  startDevServer(repoPath: string): Promise<DevServerStatus>;
  stopDevServer(repoPath: string): Promise<void>;
  getDevServerStatus(repoPath: string): Promise<DevServerStatus>;
  onDevServerStatus(cb: (repoPath: string, status: DevServerStatus) => void): () => void;
  onDeepLink(cb: (link: DeepLink) => void): () => void;
  onAuthCallback(cb: (auth: AuthCallback) => void): () => void;
  openExternal(url: string): Promise<void>;
  /** Wrap a localhost dev URL in the device-sized preview harness page. */
  wrapPreviewUrl(url: string, opts: { width: number; height: number; title?: string }): Promise<string>;
  startAgentSession(options: AgentStartOptions): Promise<AgentSessionInfo>;
  /** Follow-up prompt on an idle session. Rejects while a turn is running. */
  sendAgentPrompt(sessionId: string, prompt: string): Promise<void>;
  stopAgentSession(sessionId: string): Promise<void>;
  listAgentSessions(): Promise<AgentSessionInfo[]>;
  onAgentEvent(cb: (sessionId: string, event: AgentSessionEvent) => void): () => void;
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

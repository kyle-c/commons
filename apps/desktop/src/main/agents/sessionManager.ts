import { randomUUID } from "crypto";
import path from "path";
import { app } from "electron";
import type {
  AgentDraftInfo,
  AgentSessionEvent,
  AgentSessionInfo,
  AgentSessionStatus,
  AgentStartOptions,
} from "@commons/shared";
import type { AgentAdapter, AgentTurnHandle } from "./adapter";
import { claudeAdapter } from "./claudeAdapter";
import * as gitOps from "../gitOps";

type EventListener = (sessionId: string, event: AgentSessionEvent) => void;

interface DraftState {
  gitRemote: string;
  slug: string;
  checkoutPath?: string;
  branch?: string;
  baseBranch?: string;
}

interface ManagedSession {
  info: AgentSessionInfo;
  adapter: AgentAdapter;
  resumeToken?: string;
  activeTurn?: AgentTurnHandle;
  editedFiles: Set<string>;
  /** Present when the session runs in a Commons-managed checkout (draft mode). */
  draft?: DraftState;
}

const adapters: Record<string, AgentAdapter> = {
  [claudeAdapter.kind]: claudeAdapter,
};

const sessions = new Map<string, ManagedSession>();
const listeners = new Set<EventListener>();

export function onEvent(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(sessionId: string, event: AgentSessionEvent): void {
  for (const listener of listeners) listener(sessionId, event);
}

function setStatus(session: ManagedSession, status: AgentSessionStatus, error?: string): void {
  session.info.status = status;
  session.info.error = error;
  emit(session.info.sessionId, { type: "status", status, error });
}

export function list(): AgentSessionInfo[] {
  return [...sessions.values()].map((s) => s.info);
}

export function start(options: AgentStartOptions): AgentSessionInfo {
  const adapterKind = options.adapter ?? "claude-code";
  const adapter = adapters[adapterKind];
  if (!adapter) throw new Error(`Unknown agent adapter: ${adapterKind}`);
  if (!options.repoPath && !options.gitRemote) throw new Error("Agent session needs a repoPath or gitRemote.");
  const sessionId = randomUUID();
  const session: ManagedSession = {
    info: {
      sessionId,
      adapter: adapter.kind,
      repoPath: options.repoPath ?? "",
      title: options.title,
      status: "starting",
      createdAt: Date.now(),
      context: options.context ?? {},
      editedFiles: [],
    },
    adapter,
    editedFiles: new Set(),
    draft: options.gitRemote
      ? { gitRemote: options.gitRemote, slug: options.draftSlug ?? "draft" }
      : undefined,
  };
  sessions.set(sessionId, session);
  // Defer the first turn a tick so the start() IPC reply reaches the renderer
  // before events stream — the host renderer needs the id to mirror events.
  setImmediate(() => runTurn(session, options.prompt));
  return session.info;
}

/**
 * Draft mode: sessions run in a Commons-owned clone on a fresh branch — never
 * in anyone's working tree. First call clones (can take a while); later
 * sessions reuse the checkout. Turns after the first reuse the same branch.
 */
async function ensureDraftWorkspace(session: ManagedSession): Promise<string> {
  const draft = session.draft!;
  if (draft.checkoutPath && draft.branch) return draft.checkoutPath;
  const { sessionId } = session.info;
  emit(sessionId, { type: "tool", toolUseId: "git-checkout", name: "git", summary: "$ preparing draft workspace (clone/fetch)" });
  const checkoutsRoot = path.join(app.getPath("userData"), "checkouts");
  draft.checkoutPath = await gitOps.ensureCheckout(draft.gitRemote, checkoutsRoot);
  const { branch, baseBranch } = await gitOps.prepareDraftBranch(draft.checkoutPath, draft.slug);
  draft.branch = branch;
  draft.baseBranch = baseBranch;
  session.info.repoPath = draft.checkoutPath;
  emit(sessionId, { type: "tool", toolUseId: "git-branch", name: "git", summary: `$ git checkout -B ${branch} origin/${baseBranch}` });
  return draft.checkoutPath;
}

/** Follow-up prompt on an idle session (multi-turn via the adapter's resume token). */
export function prompt(sessionId: string, text: string): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Agent session not found.");
  if (session.activeTurn) throw new Error("Agent is still working — wait for the current turn to finish.");
  runTurn(session, text);
}

function runTurn(session: ManagedSession, promptText: string): void {
  const { sessionId } = session.info;
  setStatus(session, session.resumeToken ? "running" : "starting");
  emit(sessionId, { type: "prompt", text: promptText });

  void (async () => {
    // Draft mode runs in the managed checkout; classic mode in the linked tree.
    let cwd: string;
    try {
      cwd = session.draft ? await ensureDraftWorkspace(session) : session.info.repoPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit(sessionId, { type: "result", ok: false, summary: message, durationMs: 0, numTurns: 0, editedFiles: [] });
      setStatus(session, "error", message);
      return;
    }

    const handle = session.adapter.startTurn({
      repoPath: cwd,
      prompt: promptText,
      resumeToken: session.resumeToken,
      emit: (event) => {
        // First streamed activity flips starting → running.
        if (session.info.status === "starting") setStatus(session, "running");
        emit(sessionId, event);
      },
      onFileEdited: (absolutePath) => {
        const rel = path.relative(cwd, absolutePath);
        const filePath = rel === "" || rel.startsWith("..") ? absolutePath : rel;
        if (!session.editedFiles.has(filePath)) {
          session.editedFiles.add(filePath);
          session.info.editedFiles = [...session.editedFiles];
        }
      },
    });
    session.activeTurn = handle;

    const outcome = await handle.done;
    // A stop() may have already finalized the session while the turn drained.
    if (session.activeTurn !== handle) return;
    session.activeTurn = undefined;
    session.resumeToken = outcome.resumeToken ?? session.resumeToken;

    // Draft mode: land this turn's edits on the Commons-owned branch.
    let draftInfo: AgentDraftInfo | undefined;
    const draft = session.draft;
    if (draft?.branch && draft.checkoutPath && outcome.ok && session.editedFiles.size > 0) {
      emit(sessionId, {
        type: "tool",
        toolUseId: `git-push-${Date.now()}`,
        name: "git",
        summary: `$ git commit && git push origin ${draft.branch}`,
      });
      const landed = await gitOps.commitAndPushDraft(draft.checkoutPath, draft.branch, session.info.title);
      draftInfo = {
        branch: draft.branch,
        baseBranch: draft.baseBranch ?? "main",
        committed: landed.committed,
        pushed: landed.pushed,
        compareUrl: landed.pushed
          ? gitOps.compareUrl(draft.gitRemote, draft.baseBranch ?? "main", draft.branch)
          : undefined,
        pushError: landed.error,
      };
    }

    emit(sessionId, {
      type: "result",
      ok: outcome.ok,
      summary: outcome.summary,
      durationMs: outcome.durationMs,
      numTurns: outcome.numTurns,
      totalCostUsd: outcome.totalCostUsd,
      editedFiles: [...session.editedFiles],
      draft: draftInfo,
    });
    if (outcome.ok) setStatus(session, "idle");
    else setStatus(session, "error", outcome.summary);
  })();
}

export async function stop(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  const turn = session.activeTurn;
  session.activeTurn = undefined;
  if (turn) await turn.interrupt();
  setStatus(session, "stopped");
}

export async function stopAll(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => stop(id)));
}

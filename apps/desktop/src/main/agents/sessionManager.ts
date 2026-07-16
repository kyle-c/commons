import { randomUUID } from "crypto";
import path from "path";
import type {
  AgentSessionEvent,
  AgentSessionInfo,
  AgentSessionStatus,
  AgentStartOptions,
} from "@commons/shared";
import type { AgentAdapter, AgentTurnHandle } from "./adapter";
import { claudeAdapter } from "./claudeAdapter";

type EventListener = (sessionId: string, event: AgentSessionEvent) => void;

interface ManagedSession {
  info: AgentSessionInfo;
  adapter: AgentAdapter;
  resumeToken?: string;
  activeTurn?: AgentTurnHandle;
  editedFiles: Set<string>;
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
  const sessionId = randomUUID();
  const session: ManagedSession = {
    info: {
      sessionId,
      adapter: adapter.kind,
      repoPath: options.repoPath,
      title: options.title,
      status: "starting",
      createdAt: Date.now(),
      context: options.context ?? {},
      editedFiles: [],
    },
    adapter,
    editedFiles: new Set(),
  };
  sessions.set(sessionId, session);
  // Defer the first turn a tick so the start() IPC reply reaches the renderer
  // before events stream — the host renderer needs the id to mirror events.
  setImmediate(() => runTurn(session, options.prompt));
  return session.info;
}

/** Follow-up prompt on an idle session (multi-turn via the adapter's resume token). */
export function prompt(sessionId: string, text: string): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Agent session not found.");
  if (session.activeTurn) throw new Error("Agent is still working — wait for the current turn to finish.");
  runTurn(session, text);
}

function runTurn(session: ManagedSession, promptText: string): void {
  const { sessionId, repoPath } = session.info;
  setStatus(session, session.resumeToken ? "running" : "starting");
  emit(sessionId, { type: "prompt", text: promptText });

  const handle = session.adapter.startTurn({
    repoPath,
    prompt: promptText,
    resumeToken: session.resumeToken,
    emit: (event) => {
      // First streamed activity flips starting → running.
      if (session.info.status === "starting") setStatus(session, "running");
      emit(sessionId, event);
    },
    onFileEdited: (absolutePath) => {
      const rel = path.relative(repoPath, absolutePath);
      const filePath = rel === "" || rel.startsWith("..") ? absolutePath : rel;
      if (!session.editedFiles.has(filePath)) {
        session.editedFiles.add(filePath);
        session.info.editedFiles = [...session.editedFiles];
      }
    },
  });
  session.activeTurn = handle;

  handle.done.then((outcome) => {
    // A stop() may have already finalized the session while the turn drained.
    if (session.activeTurn !== handle) return;
    session.activeTurn = undefined;
    session.resumeToken = outcome.resumeToken ?? session.resumeToken;
    emit(sessionId, {
      type: "result",
      ok: outcome.ok,
      summary: outcome.summary,
      durationMs: outcome.durationMs,
      numTurns: outcome.numTurns,
      totalCostUsd: outcome.totalCostUsd,
      editedFiles: [...session.editedFiles],
    });
    if (outcome.ok) setStatus(session, "idle");
    else setStatus(session, "error", outcome.summary);
  });
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

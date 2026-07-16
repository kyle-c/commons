import type { AgentAdapterKind, AgentSessionEvent } from "@commons/shared";

/** What one agent turn produced. Turns never reject — failures land here as ok: false. */
export interface AgentTurnOutcome {
  ok: boolean;
  /** Final assistant text on success, or a human-readable error. */
  summary: string;
  numTurns: number;
  durationMs: number;
  totalCostUsd?: number;
  /** Adapter-native token that resumes this conversation on the next turn. */
  resumeToken?: string;
}

export interface AgentTurnRequest {
  repoPath: string;
  prompt: string;
  /** Token returned by a previous turn of the same session, if any. */
  resumeToken?: string;
  /** Streamed, normalized events (text / tool / tool-result). Status + result events are the manager's job. */
  emit(event: AgentSessionEvent): void;
  /** Reported whenever the adapter observes the agent editing a file (absolute path). */
  onFileEdited(absolutePath: string): void;
}

export interface AgentTurnHandle {
  done: Promise<AgentTurnOutcome>;
  interrupt(): Promise<void>;
}

/**
 * One implementation per coding agent (Claude Code today; Codex CLI later).
 * Adapters translate agent-native streams into AgentSessionEvents and know
 * nothing about Commons sessions, IPC, or the renderer.
 */
export interface AgentAdapter {
  kind: AgentAdapterKind;
  startTurn(request: AgentTurnRequest): AgentTurnHandle;
}

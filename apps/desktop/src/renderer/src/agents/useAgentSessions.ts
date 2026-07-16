import { useEffect, useRef, useState } from "react";
import type { AgentSessionEvent, AgentSessionInfo, AgentStartOptions } from "@commons/shared";

export type AgentResultEvent = Extract<AgentSessionEvent, { type: "result" }>;

/**
 * Mirrors main-process agent sessions into React state: the session list plus
 * an ordered transcript of events per session.
 */
export function useAgentSessions(onResult?: (session: AgentSessionInfo, event: AgentResultEvent) => void) {
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, AgentSessionEvent[]>>({});
  const sessionsRef = useRef<AgentSessionInfo[]>([]);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const applySessions = (updater: (prev: AgentSessionInfo[]) => AgentSessionInfo[]) => {
    sessionsRef.current = updater(sessionsRef.current);
    setSessions(sessionsRef.current);
  };

  useEffect(() => {
    if (!window.commons) return;
    let cancelled = false;
    window.commons.listAgentSessions().then((list) => {
      if (!cancelled) applySessions(() => list);
    });
    const unsubscribe = window.commons.onAgentEvent((sessionId, event) => {
      setTranscripts((prev) => ({ ...prev, [sessionId]: [...(prev[sessionId] ?? []), event] }));
      if (event.type === "status") {
        applySessions((prev) =>
          prev.map((s) => (s.sessionId === sessionId ? { ...s, status: event.status, error: event.error } : s))
        );
      } else if (event.type === "result") {
        applySessions((prev) =>
          prev.map((s) => (s.sessionId === sessionId ? { ...s, editedFiles: event.editedFiles } : s))
        );
        const session = sessionsRef.current.find((s) => s.sessionId === sessionId);
        if (session) onResultRef.current?.(session, event);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (options: AgentStartOptions): Promise<AgentSessionInfo> => {
    const info = await window.commons.startAgentSession(options);
    applySessions((prev) => [info, ...prev.filter((s) => s.sessionId !== info.sessionId)]);
    return info;
  };

  const sendPrompt = (sessionId: string, prompt: string) => window.commons.sendAgentPrompt(sessionId, prompt);
  const stop = (sessionId: string) => window.commons.stopAgentSession(sessionId);

  return { sessions, transcripts, start, sendPrompt, stop };
}

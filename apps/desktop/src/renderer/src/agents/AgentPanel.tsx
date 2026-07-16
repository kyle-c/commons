import { useEffect, useRef, useState } from "react";
import type { AgentSessionEvent, AgentSessionStatus } from "@commons/shared";

/** Panel view of a mirrored agent session (source of truth: Convex). */
export interface PanelSession {
  id: string;
  title: string;
  status: AgentSessionStatus;
  routePath?: string;
  hostName?: string;
  /** True when this app instance hosts the session and can steer it. */
  canControl: boolean;
}

interface Props {
  sessions: PanelSession[];
  /** Ordered transcript of the active session. */
  transcript: AgentSessionEvent[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onSendPrompt: (sessionId: string, prompt: string) => Promise<void>;
  onStop: (sessionId: string) => void;
  onClose: () => void;
}

function TranscriptItem({ event }: { event: AgentSessionEvent }) {
  switch (event.type) {
    case "prompt":
      return <div className="agent-item prompt">{event.text}</div>;
    case "text":
      return <div className="agent-item text">{event.text}</div>;
    case "tool":
      return (
        <div className="agent-item tool" title={event.name}>
          {event.summary}
        </div>
      );
    case "tool-result":
      return event.isError ? <div className="agent-item tool failed">tool call failed</div> : null;
    case "status":
      if (event.status === "error" && event.error) return <div className="agent-item failed">{event.error}</div>;
      if (event.status === "stopped") return <div className="agent-item tool">Session stopped</div>;
      return null;
    case "result": {
      if (!event.ok) return <div className="agent-item failed">{event.summary}</div>;
      const seconds = Math.max(1, Math.round(event.durationMs / 1000));
      return (
        <div className="agent-item done">
          <span>
            Done · {event.numTurns} turns · {seconds}s
            {event.totalCostUsd !== undefined && ` · $${event.totalCostUsd.toFixed(2)}`}
          </span>
          {event.editedFiles.length > 0 && (
            <div className="files">
              {event.editedFiles.map((file) => (
                <code key={file}>{file}</code>
              ))}
            </div>
          )}
        </div>
      );
    }
  }
}

export default function AgentPanel({
  sessions,
  transcript,
  activeSessionId,
  onSelectSession,
  onSendPrompt,
  onStop,
  onClose,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;
  const busy = active !== null && (active.status === "running" || active.status === "starting");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript.length, active?.id]);

  const submit = async () => {
    if (!active || busy || !active.canControl) return;
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await onSendPrompt(active.id, text);
  };

  return (
    <div className="agent-panel">
      <header>
        <span>
          Agent {active && <span className={`agent-status ${active.status}`}>{active.status}</span>}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {busy && active?.canControl && (
            <button className="btn ghost" onClick={() => onStop(active.id)}>
              Stop
            </button>
          )}
          <button className="btn ghost" title="Close (A)" onClick={onClose}>
            ✕
          </button>
        </div>
      </header>

      {sessions.length > 1 && (
        <div className="agent-tabs">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === active?.id ? "on" : ""}
              onClick={() => onSelectSession(session.id)}
              title={session.title}
            >
              <span className={`agent-status-dot ${session.status}`} />
              {session.title}
            </button>
          ))}
        </div>
      )}

      {active ? (
        <>
          <div className="agent-session-title" title={active.routePath}>
            {active.title}
            {active.routePath && <span className="route">{active.routePath}</span>}
          </div>
          <div className="agent-transcript" ref={scrollRef}>
            {transcript.length === 0 && <div className="agent-item tool">Starting session…</div>}
            {transcript.map((event, i) => (
              <TranscriptItem key={i} event={event} />
            ))}
          </div>
          {active.canControl ? (
            <div className="agent-composer">
              <textarea
                value={draft}
                placeholder={busy ? "Agent is working…" : "Follow up…"}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <button className="btn" disabled={busy || !draft.trim()} onClick={submit}>
                Send
              </button>
            </div>
          ) : (
            <div className="agent-spectator hint">
              Running on {active.hostName ?? "a teammate"}’s machine — you’re watching along.
            </div>
          )}
        </>
      ) : (
        <div className="agent-empty hint">
          No agent sessions yet.
          <br />
          Open a comment thread and hit “Agent” to send it to Claude Code.
        </div>
      )}
    </div>
  );
}

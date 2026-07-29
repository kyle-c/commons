import { useEffect, useRef, useState } from "react";
import type { AgentSessionEvent, AgentSessionStatus, MergePreview } from "@commons/shared";

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
  /** Open the main-vs-draft side-by-side compare (PRJ-14). */
  onCompareDraft?: (draftPreviewUrl: string, routePath: string | undefined, title: string) => void;
  /** This machine's working copy, for the merge check. Absent = no check. */
  repoPath?: string;
  /** Hand a conflicted draft back to the agent that wrote it. */
  onReconcile?: (branch: string, baseBranch: string, conflicts: string[]) => void;
}

function TranscriptItem({
  event,
  session,
  onCompareDraft,
  repoPath,
  onReconcile,
}: {
  event: AgentSessionEvent;
  session: PanelSession | null;
  onCompareDraft?: Props["onCompareDraft"];
  repoPath?: string;
  onReconcile?: Props["onReconcile"];
}) {
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
          {event.draft && (
            <div className="draft-row">
              <code title={`Branched from ${event.draft.baseBranch}`}>{event.draft.branch}</code>
              {event.draft.previewUrl && (
                <button
                  className="btn ghost"
                  title="Open the draft branch's deploy preview (may take a minute to build after the push)"
                  onClick={() =>
                    window.commons.openExternal(`${event.draft!.previewUrl!}${session?.routePath ?? ""}`)
                  }
                >
                  View draft ↗
                </button>
              )}
              {event.draft.previewUrl && onCompareDraft && (
                <button
                  className="btn ghost"
                  title="Current vs draft, side by side"
                  onClick={() => onCompareDraft(event.draft!.previewUrl!, session?.routePath, session?.title ?? "Draft")}
                >
                  Compare
                </button>
              )}
              <DraftActions draft={event.draft} repoPath={repoPath} onReconcile={onReconcile} />
              {event.draft.committed && !event.draft.pushed && (
                <span className="failed" title={event.draft.pushError}>
                  push failed
                </span>
              )}
            </div>
          )}
        </div>
      );
    }
  }
}

/**
 * Ship, or reconcile first.
 *
 * A draft branch is cut from the base at session start, and the base keeps
 * moving. By the time someone reviews the draft it may no longer merge, and
 * the honest place to say so is next to the button that would have merged it.
 *
 * The remedy is deliberately not a merge UI. Conflicts go back to the agent
 * that wrote the branch, which is the only resolution path that works for
 * someone who does not read diffs. The check itself never touches the working
 * tree, so asking the question cannot disturb anything.
 */
function DraftActions({
  draft,
  repoPath,
  onReconcile,
}: {
  draft: { branch: string; baseBranch: string; compareUrl?: string };
  repoPath?: string;
  onReconcile?: (branch: string, baseBranch: string, conflicts: string[]) => void;
}) {
  const [preview, setPreview] = useState<MergePreview | null>(null);

  useEffect(() => {
    if (!repoPath || !window.commons?.mergePreview) return;
    let cancelled = false;
    void window.commons
      .mergePreview(repoPath, draft.branch, draft.baseBranch)
      .then((result) => !cancelled && setPreview(result))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repoPath, draft.branch, draft.baseBranch]);

  const conflicted = preview?.supported === true && preview.clean === false;

  return (
    <>
      {draft.compareUrl && (
        <button
          className={conflicted ? "btn ghost" : "btn"}
          title={
            conflicted
              ? `${draft.branch} no longer merges into ${draft.baseBranch} cleanly. Reconcile first.`
              : undefined
          }
          onClick={() => window.commons.openExternal(draft.compareUrl!)}
        >
          Ship ↗
        </button>
      )}
      {conflicted && onReconcile && (
        <button
          className="btn"
          title={`${preview!.conflicts.length} file${preview!.conflicts.length === 1 ? "" : "s"} conflict with ${
            draft.baseBranch
          }: ${preview!.conflicts.join(", ")}. Hands them back to the agent.`}
          onClick={() => onReconcile(draft.branch, draft.baseBranch, preview!.conflicts)}
        >
          Reconcile
        </button>
      )}
    </>
  );
}

export default function AgentPanel({
  sessions,
  transcript,
  activeSessionId,
  onSelectSession,
  onSendPrompt,
  onStop,
  onClose,
  onCompareDraft,
  repoPath,
  onReconcile,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;
  const busy = active !== null && (active.status === "running" || active.status === "starting");
  // Live spend meter (AG-7): the SDK reports session-cumulative cost per result.
  const spentUsd = transcript.reduce(
    (max, e) => (e.type === "result" && e.totalCostUsd !== undefined ? Math.max(max, e.totalCostUsd) : max),
    0
  );

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
          {spentUsd > 0 && (
            <span
              className="agent-status"
              title="This session's API spend on the host's credentials — sessions lock at the $5 ceiling"
              style={spentUsd >= 4 ? { color: "var(--danger, #f87171)" } : undefined}
            >
              ${spentUsd.toFixed(2)} / $5
            </span>
          )}
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
              <TranscriptItem
                key={i}
                event={event}
                session={active}
                onCompareDraft={onCompareDraft}
                repoPath={repoPath}
                onReconcile={onReconcile}
              />
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { AnnotationCitation, AnnotationEvidence } from "@commons/shared";
import type { ThreadWithMessages } from "../comments/types";
import { markFirst } from "../lib/firsts";
import { sessionToken } from "../lib/session";

/**
 * NAR-1/2: the narration panel. Hosts run the annotation pass (Generate);
 * everyone curates drafts in a keyboard review queue (j/k · a approve ·
 * e edit · x reject). Approved annotations feed the canvas Notes layer and
 * the web share page. Rejections and edits build the NAR-4 voice corpus.
 */

const EDIT_REASONS = ["tone", "ordering", "concision", "accuracy"] as const;

function CitationBadges({ citations }: { citations: AnnotationCitation[] }) {
  if (citations.length === 0) return <span className="citation inferred">inferred</span>;
  return (
    <>
      {citations.map((c, i) => (
        <span
          key={i}
          className={`citation ${c.verified === false ? "unverified" : ""}`}
          title={c.verified === false ? `${c.ref}: could not be verified against the repo` : c.ref}
        >
          {c.kind} · {c.ref.length > 34 ? `${c.ref.slice(0, 32)}…` : c.ref}
        </span>
      ))}
    </>
  );
}

interface Props {
  me: Doc<"users">;
  project: Doc<"projects">;
  frames: Doc<"frames">[];
  threads: ThreadWithMessages[];
  repoPath?: string;
  onClose: () => void;
}

export default function NarrationPanel({ me, project, frames, threads, repoPath, onClose }: Props) {
  const data = useQuery(api.annotations.forProject, {
    projectId: project._id,
    userId: me._id,
    sessionToken: sessionToken(),
  });
  const tests = useQuery(api.userTests.forProject, {
    projectId: project._id,
    userId: me._id,
    sessionToken: sessionToken(),
  });
  // NAR-4: what the team's past edits taught us about their voice, fed back
  // into the next run so each pass starts warmer than the last.
  const voice = useQuery(api.annotations.voiceCorpus, {
    projectId: project._id,
    userId: me._id,
    sessionToken: sessionToken(),
  });
  const startRun = useMutation(api.annotations.startRun);
  const finishRun = useMutation(api.annotations.finishRun);
  const curate = useMutation(api.annotations.curate);
  const unapprove = useMutation(api.annotations.unapprove);

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editReasons, setEditReasons] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const frameTitles = useMemo(() => new Map(frames.map((f) => [f._id as string, f.title])), [frames]);
  const annotations = data?.annotations ?? [];
  const drafts = annotations.filter((a) => a.status === "draft");
  const approved = annotations.filter((a) => a.status === "approved");
  const current = drafts[Math.min(selected, Math.max(0, drafts.length - 1))];

  useEffect(() => {
    if (!window.commons?.onAnnotatorProgress || !repoPath) return;
    return window.commons.onAnnotatorProgress((progressRepo, summary) => {
      if (progressRepo === repoPath) setProgress(summary);
    });
  }, [repoPath]);

  const placeLabel = (a: (typeof annotations)[number]) =>
    a.frameId ? (frameTitles.get(a.frameId) ?? "Screen") : (a.flowTitle ?? "Flow");

  const generate = async () => {
    if (!repoPath || !window.commons || generating) return;
    setGenerating(true);
    setGenError(null);
    setProgress("Starting the annotation pass…");
    let runId: Id<"annotationRuns"> | null = null;
    try {
      runId = await startRun({ projectId: project._id, userId: me._id, sessionToken: sessionToken() });
      const evidence: AnnotationEvidence = {
        threads: threads.slice(0, 40).map((t) => ({
          id: t._id,
          frameTitle: t.frameId ? frameTitles.get(t.frameId) : undefined,
          summary:
            (t.messages[0]?.body ?? "").slice(0, 220) +
            (t.messages.length > 1 ? ` (+${t.messages.length - 1} replies)` : ""),
        })),
        tests: (tests ?? []).slice(0, 20).map((t) => ({ id: t._id, summary: `${t.title} (${t.status})` })),
        voice: voice ?? [],
      };
      const result = await window.commons.generateAnnotations({
        repoPath,
        projectName: project.name,
        frames: frames.filter((f) => f.kind === "route").map((f) => ({ title: f.title, routePath: f.routePath })),
        evidence,
      });
      if (!result.ok) {
        await finishRun({ runId, drafts: [], error: result.error ?? "Annotation pass failed.", userId: me._id, sessionToken: sessionToken() });
        setGenError(result.error ?? "Annotation pass failed.");
        return;
      }
      await finishRun({
        runId,
        drafts: result.drafts,
        confidenceNotes: result.confidenceNotes,
        userId: me._id,
        sessionToken: sessionToken(),
      });
      setSelected(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGenError(message);
      if (runId) {
        void finishRun({ runId, drafts: [], error: message, userId: me._id, sessionToken: sessionToken() }).catch(() => {});
      }
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const decide = async (action: "approve" | "edit" | "reject") => {
    if (!current) return;
    if (action === "approve") markFirst("narrate");
    await curate({
      annotationId: current._id,
      action,
      text: action === "edit" ? editText : undefined,
      reason: action === "edit" && editReasons.length > 0 ? editReasons.join(",") : undefined,
      userId: me._id,
      sessionToken: sessionToken(),
    });
    setEditing(false);
    setEditReasons([]);
    setSelected((i) => Math.min(i, Math.max(0, drafts.length - 2)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return; // the textarea owns the keyboard
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, drafts.length - 1));
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "a" && current) {
      e.preventDefault();
      void decide("approve");
    } else if (e.key === "x" && current) {
      e.preventDefault();
      void decide("reject");
    } else if (e.key === "e" && current) {
      e.preventDefault();
      setEditText(current.text);
      setEditing(true);
    }
  };

  return (
    <div className="agent-panel narration-panel" tabIndex={0} onKeyDown={onKeyDown}>
      <header>
        <strong>Narrate</strong>
        <span style={{ flex: 1 }} />
        {repoPath && window.commons && (
          <button className="btn" disabled={generating} onClick={generate} title="Runs on your machine and your Anthropic credentials. Mines this repo's git history, docs, and the project's threads and tests">
            {generating ? "Narrating…" : annotations.length > 0 ? "Re-narrate" : "Generate"}
          </button>
        )}
        <button className="btn ghost" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="panel-sub hint">
        Explains the thinking behind each screen — sourced from your comments, tests, and code changes.
      </div>

      <div className="narration-body" ref={listRef}>
        {generating && (
          <div className="narration-progress">
            <span className="status-dot starting" /> {progress ?? "Working…"}
          </div>
        )}
        {genError && <div className="agent-item failed">{genError}</div>}
        {!repoPath && annotations.length === 0 && !generating && (
          <div className="hint" style={{ padding: 16 }}>
            Narrate writes the why behind each screen — pulled from this project's comments, tests, and
            code history, with citations. Generating runs on a machine with the project's code; drafts land
            here for the whole team to review.
          </div>
        )}
        {repoPath && annotations.length === 0 && !generating && !genError && (
          <div className="hint" style={{ padding: 16 }}>
            Hit Generate and Narrate reads this project's comments, tests, and code history, then drafts
            the why behind each screen — with citations. Nothing shows under a screen until you approve it.
          </div>
        )}

        {data?.latestRun?.status === "done" && data.latestRun.confidenceNotes && drafts.length > 0 && (
          <div className="narration-confidence">
            <strong>Where the model was guessing:</strong> {data.latestRun.confidenceNotes}
          </div>
        )}

        {drafts.length > 0 && (
          <>
            <div className="narration-section">
              {drafts.length} draft{drafts.length === 1 ? "" : "s"} to review
              <span className="hint" style={{ marginLeft: 8 }}>
                j/k move · a approve · e edit · x reject
              </span>
            </div>
            {drafts.map((a, i) => (
              <div
                key={a._id}
                className={`narration-item ${i === Math.min(selected, drafts.length - 1) ? "hl" : ""}`}
                onClick={() => setSelected(i)}
              >
                <div className="narration-place">{placeLabel(a)}</div>
                {editing && a._id === current?._id ? (
                  <>
                    <textarea
                      value={editText}
                      autoFocus
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(false);
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void decide("edit");
                      }}
                    />
                    <div className="narration-reasons">
                      {EDIT_REASONS.map((reason) => (
                        <button
                          key={reason}
                          className={`chip ${editReasons.includes(reason) ? "on" : ""}`}
                          title="Optional: tag why you changed it. This teaches the model your voice"
                          onClick={() =>
                            setEditReasons((prev) =>
                              prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
                            )
                          }
                        >
                          {reason}
                        </button>
                      ))}
                      <span style={{ flex: 1 }} />
                      <button className="btn ghost" onClick={() => setEditing(false)}>
                        Cancel
                      </button>
                      <button className="btn primary" disabled={!editText.trim()} onClick={() => void decide("edit")}>
                        Approve edit
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="narration-text">{a.text}</div>
                    <div className="narration-citations">
                      <CitationBadges citations={a.citations} />
                    </div>
                    {i === Math.min(selected, drafts.length - 1) && (
                      <div className="narration-actions">
                        <button className="btn primary" onClick={() => void decide("approve")}>
                          Approve
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => {
                            setEditText(a.text);
                            setEditing(true);
                          }}
                        >
                          Edit
                        </button>
                        <button className="btn ghost" onClick={() => void decide("reject")}>
                          Reject
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </>
        )}

        {approved.length > 0 && (
          <>
            <div className="narration-section">Published ({approved.length}): on the canvas Notes layer and the web link</div>
            {approved.map((a) => (
              <div key={a._id} className="narration-item published">
                <div className="narration-place">
                  {placeLabel(a)}
                  <button
                    className="btn ghost"
                    style={{ float: "right" }}
                    title="Back to drafts for re-curation"
                    onClick={() => void unapprove({ annotationId: a._id, userId: me._id, sessionToken: sessionToken() })}
                  >
                    Unpublish
                  </button>
                </div>
                <div className="narration-text">{a.text}</div>
                <div className="narration-citations">
                  <CitationBadges citations={a.citations} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

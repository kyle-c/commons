import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import { sessionToken, timeAgo } from "../lib/session";
import Icon from "../components/icons";

/**
 * The coverage ledger: what Commons knows it cannot show.
 *
 * The canvas's quiet failure mode is under-representation — screens that
 * exist but never appear, routes rendering a login gate while claiming to be
 * themselves. Static discovery cannot notice its own blind spots, so this
 * panel pairs a runtime survey (drive the real app, report the difference)
 * with a ledger where every gap is a named item carrying its own fix action.
 * The no-dead-ends rule, applied to coverage itself.
 *
 * The survey proposes, never asserts: findings land in the same review queue
 * as the CI crawl's, and nothing joins the canvas unapproved.
 */
export default function CoverageLedger({
  project,
  me,
  frames,
  baseUrl,
  routes,
  onGoReview,
  onSignIn,
  onClose,
}: {
  project: Doc<"projects">;
  me: Doc<"users">;
  frames: Doc<"frames">[];
  /** Where the app renders from right now (dev server or preview), if anywhere. */
  baseUrl: string | null;
  routes: { path: string; dynamic: boolean }[];
  /** Opens the Flow view's review queue, where proposals wait. */
  onGoReview: () => void;
  /** The existing sign-in-to-previews flow, for gated routes. */
  onSignIn?: () => void;
  onClose: () => void;
}) {
  const proposals = useQuery(api.flows.proposals, {
    projectId: project._id,
    userId: me._id,
    sessionToken: sessionToken(),
  });
  const ingest = useMutation(api.flows.ingestLocalProposal);
  const recordSurvey = useMutation(api.projects.recordSurvey);
  const generateUploadUrl = useMutation(api.comments.generateUploadUrl);

  const [surveying, setSurveying] = useState(false);
  const [progress, setProgress] = useState<{ visited: number; total: number; current: string } | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    if (!window.commons?.onSurveyProgress) return;
    return window.commons.onSurveyProgress(setProgress);
  }, []);

  const pending = (proposals ?? []).length;
  const report = project.surveyReport;
  const dynamicRoutes = frames.filter((f) => f.kind === "route" && (f.routePath ?? "").includes("["));

  const runSurvey = async () => {
    if (!baseUrl || !window.commons?.surveyApp || surveying) return;
    setSurveying(true);
    setLastRun(null);
    try {
      const result = await window.commons.surveyApp(baseUrl, routes);
      let proposed = 0;
      for (const screen of result.screens) {
        if (screen.png.length === 0) continue;
        const url = await generateUploadUrl({ userId: me._id, sessionToken: sessionToken() });
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: new Blob([screen.png as BlobPart], { type: "image/png" }),
        });
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        const outcome = await ingest({
          projectId: project._id,
          kind: "screen",
          routePath: screen.path,
          label: screen.title,
          signature: screen.signature,
          storageId,
          width: screen.width,
          height: screen.height,
          userId: me._id,
          sessionToken: sessionToken(),
        });
        if (!outcome.deduped) proposed += 1;
      }
      await recordSurvey({
        projectId: project._id,
        report: {
          at: Date.now(),
          pagesVisited: result.pagesVisited,
          proposed,
          gatedRoutes: result.gatedRoutes,
          unresolvedDynamic: result.unresolvedDynamic,
        },
        userId: me._id,
        sessionToken: sessionToken(),
      });
      setLastRun(
        proposed > 0
          ? `Found ${proposed} screen${proposed === 1 ? "" : "s"} the canvas doesn't have — review to add them.`
          : result.gatedRoutes.length > 0
            ? "Nothing new past the sign-in gate. Sign in to previews, then survey again."
            : "The canvas matches the app. Nothing was missing."
      );
    } catch {
      setLastRun("The survey couldn't finish — is the app still running?");
    } finally {
      setSurveying(false);
      setProgress(null);
    }
  };

  return (
    <div className="agent-panel">
      <header>
        <span>Coverage</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn ghost icon-btn" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="coverage-body">
        <div className="coverage-row headline">
          <span>
            <b>{frames.filter((f) => f.kind === "route").length}</b> screens ·{" "}
            <b>{frames.filter((f) => f.kind === "state").length}</b> states on the canvas
          </span>
        </div>

        <div className="coverage-section">
          <span className="pop-section">Survey the running app</span>
          <span className="hint">
            Drives every screen in a hidden window, follows where the app itself links, and
            reports anything the canvas is missing. Findings wait for your review — nothing is
            added on its own.
          </span>
          <div className="reveal-form-row">
            <button className="btn primary" disabled={!baseUrl || surveying} onClick={() => void runSurvey()}>
              {surveying
                ? progress
                  ? `Visiting ${progress.current} (${progress.visited}/${progress.total})…`
                  : "Surveying…"
                : "Survey now"}
            </button>
          </div>
          {!baseUrl && (
            <span className="hint">
              Needs the app running — start the dev server or set a preview link, then survey.
            </span>
          )}
          {lastRun && <span className="hint">{lastRun}</span>}
          {report && !surveying && (
            <span className="hint">
              Last survey {timeAgo(report.at)} ago: {report.pagesVisited} pages, {report.proposed} proposed.
            </span>
          )}
        </div>

        {pending > 0 && (
          <div className="coverage-section">
            <span className="pop-section">Awaiting your review</span>
            <button className="link-row" onClick={onGoReview}>
              <Icon name="flow" />
              <span className="lr-text">
                <span className="lr-title">
                  {pending} finding{pending === 1 ? "" : "s"} in the queue
                </span>
                <span className="lr-sub">Approve what's real; rejections are remembered.</span>
              </span>
            </button>
          </div>
        )}

        {(report?.gatedRoutes.length ?? 0) > 0 && (
          <div className="coverage-section">
            <span className="pop-section">Behind the sign-in gate</span>
            <span className="hint">
              {report!.gatedRoutes.length} route{report!.gatedRoutes.length === 1 ? "" : "s"} showed a
              sign-in form instead of themselves:{" "}
              <span className="mono">{report!.gatedRoutes.slice(0, 4).join("  ")}</span>
              {report!.gatedRoutes.length > 4 ? " …" : ""}
            </span>
            {onSignIn && (
              <div className="reveal-form-row">
                <button className="btn" onClick={onSignIn}>
                  Sign in to previews…
                </button>
              </div>
            )}
          </div>
        )}

        {dynamicRoutes.length > 0 && (
          <div className="coverage-section">
            <span className="pop-section">Dynamic routes without a sample</span>
            <span className="hint">
              These can't render until a real value fills the bracket — click one on the canvas
              and edit its path:
            </span>
            {dynamicRoutes.slice(0, 6).map((f) => (
              <span key={f._id} className="mono coverage-item">
                {f.routePath}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

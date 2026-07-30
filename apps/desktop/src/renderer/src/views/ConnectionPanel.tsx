import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Id } from "@commons/backend/convex/_generated/dataModel";
import { sessionToken } from "../lib/session";

/**
 * "Why isn't my preview updating?", answered without a terminal.
 *
 * Four separate things can break this connection, and inside Commons all four
 * look the same: an empty preview field. Working out which one you were in
 * previously required signing a JWT as the GitHub App and reading three
 * undocumented endpoints. That is a fine way to spend an afternoon once and an
 * unreasonable thing to ask of anyone who connects GitHub.
 *
 * The panel is deliberately not a dashboard. It runs the checks in dependency
 * order and stops at the first blocking one, because a repo that GitHub cannot
 * see will also have no deliveries and no deploys — reporting all three as
 * problems would be two lies and a distraction. One answer, and a link to the
 * page that fixes it.
 */

type Finding = {
  level: "ok" | "warn" | "blocked";
  title: string;
  detail: string;
  fixLabel?: string;
  fixUrl?: string;
};

function openUrl(url: string) {
  if (window.commons) void window.commons.openExternal(url);
  else window.open(url);
}

export function ConnectionPanel({
  projectId,
  userId,
  onClose,
}: {
  projectId: Id<"projects">;
  userId: Id<"users">;
  onClose: () => void;
}) {
  const diagnose = useAction(api.githubApp.diagnose);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const run = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await diagnose({ projectId, userId, sessionToken: sessionToken() });
      setFindings(result.findings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, [diagnose, projectId, userId]);

  // Checks run on open rather than behind a button: arriving here already
  // means something is wrong, and a panel whose first state is another thing
  // to click is just a slower version of the same question.
  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The first thing that blocks is the answer; anything after it is unproven,
  // because the checks below depend on the ones above.
  const answer = findings?.find((f) => f.level === "blocked");

  return (
    <div className="overlay-scrim" onMouseDown={onClose}>
      <div className="overlay-card" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <span>GitHub connection</span>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="connection-body">
          {checking && findings === null && (
            <p className="connection-progress">
              Checking the installation, its permissions, and GitHub's recent deliveries…
            </p>
          )}

          {error && (
            <div className="connection-finding blocked">
              <span className="dot" />
              <div>
                <div className="connection-title">The check itself failed</div>
                <p className="connection-detail">{error}</p>
              </div>
            </div>
          )}

          {findings && (
            <>
              {/* Say the conclusion before the evidence. */}
              <p className="connection-verdict">
                {answer
                  ? answer.title
                  : findings.some((f) => f.level === "warn")
                    ? "Connected. Nothing is broken, but something is still incomplete."
                    : "Everything checks out."}
              </p>
              {findings.map((finding, i) => (
                <div key={i} className={`connection-finding ${finding.level}`}>
                  <span className="dot" />
                  <div>
                    <div className="connection-title">{finding.title}</div>
                    <p className="connection-detail">{finding.detail}</p>
                    {finding.fixUrl && (
                      <button className="btn ghost" onClick={() => openUrl(finding.fixUrl!)}>
                        {finding.fixLabel ?? "Fix on GitHub"} ↗
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="connection-actions">
          <button className="btn ghost" onClick={() => void run()} disabled={checking}>
            {checking ? "Checking…" : "Check again"}
          </button>
        </div>
      </div>
    </div>
  );
}

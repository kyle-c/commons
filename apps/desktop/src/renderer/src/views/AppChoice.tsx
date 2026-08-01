import { useEffect, useState } from "react";
import type { AppCandidate, RepoInspection } from "@commons/shared";

/**
 * Which app in this repo should become the project?
 *
 * A monorepo with a web app and a mobile app has two right answers, and the
 * only honest moment to ask is when the project is being made — after that,
 * the answer is what the project *is*. An earlier version offered the choice
 * inside an open project instead, as a switcher that re-ran discovery and
 * swapped the canvas underneath you. Repointing a live project at different
 * code meant reconciling one app's screens with another's, which showed up as
 * frames from both stacked on top of each other. Asking once, up front,
 * removes the state that produced that.
 *
 * A repo with one app never sees this: the caller only opens it when there is
 * a genuine choice to make.
 */
export function AppChoice({
  apps,
  suggested,
  onChoose,
  onCancel,
}: {
  apps: AppCandidate[];
  /** The app Commons would have picked on its own — marked, never pre-applied. */
  suggested?: string;
  /** Inspect the chosen app and create the project from it. */
  onChoose: (inspection: RepoInspection) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // An app whose screens Commons couldn't put on the canvas. Rather than
  // creating an empty project and leaving the user to wonder, the reason
  // lands here and they can pick a different app or continue anyway.
  const [snag, setSnag] = useState<{ inspection: RepoInspection; note: string; snippet?: string } | null>(null);

  // Escape backs out, same as every other overlay — except mid-read, when
  // dismissing would leave an inspection running against a project that is
  // about to not exist.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const pick = async (app: AppCandidate) => {
    if (busy || !window.commons) return;
    setBusy(app.path);
    try {
      const inspection = await window.commons.inspectRepo(app.path);
      if (inspection.routes.length > 0) {
        await onChoose(inspection);
        return;
      }
      const screens = inspection.navigatorScreens ?? [];
      setSnag(
        screens.length > 0
          ? {
              inspection,
              note: `Found ${screens.length} screens in ${app.label} (${screens.slice(0, 3).join(", ")}…), but this app has no linking config, so they all share one web address. Add one and Commons can draw them separately.`,
              snippet: buildLinkingSnippet(screens),
            }
          : {
              inspection,
              note: `Commons can't read ${app.label}'s screens — it doesn't use file-based routing. List them in commons.json and they'll land on the canvas.`,
            }
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="overlay-scrim"
      onMouseDown={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="overlay-card" onMouseDown={(e) => e.stopPropagation()}>
        <header>Which app is this project?</header>
        <div className="reveal-form">
          {snag ? (
            <>
              <span className="form-error">{snag.note}</span>
              {snag.snippet && (
                <>
                  <pre className="linking-snippet">{snag.snippet}</pre>
                  <button
                    className="btn ghost"
                    onClick={() => void navigator.clipboard.writeText(snag.snippet!)}
                  >
                    Copy linking config
                  </button>
                </>
              )}
              <div className="reveal-form-row">
                <button className="btn" onClick={() => void onChoose(snag.inspection)}>
                  Create it anyway
                </button>
                <button className="btn ghost" onClick={() => setSnag(null)}>
                  Pick another app
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="hint">
                This repo has {apps.length} apps. Commons makes one project per app, so pick the one
                you want to look at.
              </span>
              <div className="repo-apps">
                {apps.map((app) => (
                  <button
                    key={app.path}
                    className="repo-app"
                    disabled={busy !== null}
                    title={app.path}
                    onClick={() => void pick(app)}
                  >
                    <span className="repo-app-name">{app.label}</span>
                    <span className="repo-app-kind">
                      {app.framework === "expo" ? "mobile" : app.framework}
                    </span>
                    {busy === app.path && <span className="repo-app-current">reading…</span>}
                    {busy === null && app.path === suggested && (
                      <span className="repo-app-current">suggested</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="reveal-form-row">
                <button className="btn ghost" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The `linking` config a classic React Navigation app needs before its screens
 * have web addresses. Generated from the screens actually found, kebab-cased,
 * so it can be pasted onto the NavigationContainer as-is.
 */
function buildLinkingSnippet(screens: string[]): string {
  const entries = screens
    .map((name) => `      ${name}: "${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}",`)
    .join("\n");
  return [
    "<NavigationContainer",
    "  linking={{",
    '    prefixes: ["myapp://"],',
    "    config: {",
    "      screens: {",
    entries,
    "      },",
    "    },",
    "  }}",
    ">",
  ].join("\n");
}

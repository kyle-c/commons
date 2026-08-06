import { useEffect, useState } from "react";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import { hasFirst, type FirstKey } from "../lib/firsts";

const DISMISSED_KEY = "commons.gettingStartedDismissed";

/** One row: an action that teaches by doing, checked off by the doing. */
interface Step {
  key: FirstKey | "project";
  label: string;
  detail: string;
}

/**
 * Guidance lives at the altitude of the action (the author's correction:
 * the first cut taught canvas gestures from the home screen, where none of
 * them can be performed). Home teaches entry; the project view teaches
 * doing, in a quiet panel on the canvas itself.
 */
const HOME_STEPS: Record<"designer" | "pm" | "engineer", Step[]> = {
  designer: [
    { key: "opened", label: "Open a project", detail: "Any card below — every screen in it is the real product, live." },
  ],
  pm: [
    { key: "opened", label: "Open a project", detail: "Any card below — every screen in it is the real product, live." },
  ],
  engineer: [
    { key: "project", label: "Put a repo on the canvas", detail: "+ New project, or connect GitHub and deployed repos appear on their own." },
    { key: "opened", label: "Open it", detail: "Every discovered screen lands live on the canvas." },
  ],
};

const PROJECT_STEPS: Record<"designer" | "pm" | "engineer", Step[]> = {
  designer: [
    { key: "comment", label: "Pin a comment", detail: "Press C, click the exact pixel, say the thing." },
    { key: "reaction", label: "React to a screen", detail: "Hover the 👍 under any screen — hold a beat for the full set." },
    { key: "whatif", label: "Ask what-if", detail: "Right-click a screen → ✦. An agent builds a live variant." },
  ],
  pm: [
    { key: "prototype", label: "Try the prototype", detail: "The play tab runs the real app full-size." },
    { key: "reaction", label: "React to a screen", detail: "Hover the 👍 under any screen. One click is enough." },
    { key: "test", label: "Start a user test", detail: "Tasks go out as one link; results land back on the canvas." },
  ],
  engineer: [
    { key: "comment", label: "Pin a comment", detail: "Press C — feedback lands on the exact pixel." },
    { key: "agent", label: "Send a thread to the agent", detail: "Any comment thread → ⚡. The draft comes back with a preview." },
    { key: "whatif", label: "Fire a what-if", detail: "Right-click a screen → ✦ — a live variant on a draft branch." },
  ],
};

/**
 * The getting-started card: three doors sized to the role chosen at first
 * run, each completing itself when the real thing happens (lib/firsts) —
 * never when a "next" is clicked. Retires itself when all three are done
 * or when dismissed, and never returns.
 */
export default function GettingStarted({
  me,
  hasProjects,
  scope = "home",
}: {
  me: Doc<"users">;
  hasProjects: boolean;
  /** Which altitude this instance teaches at. Dismissal is per-scope. */
  scope?: "home" | "project";
}) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(`${DISMISSED_KEY}.${scope}.${me._id}`) === "1");
  const [, bump] = useState(0);
  useEffect(() => {
    const onFirst = () => bump((n) => n + 1);
    window.addEventListener("commons:first", onFirst);
    return () => window.removeEventListener("commons:first", onFirst);
  }, []);

  const role = me.orientation;
  if (!role || dismissed) return null;
  const steps = (scope === "home" ? HOME_STEPS : PROJECT_STEPS)[role];
  const done = (step: Step) => (step.key === "project" ? hasProjects : hasFirst(step.key));
  if (steps.every(done)) return null;

  return (
    <div className={`getting-started ${scope === "project" ? "in-project" : ""}`}>
      <div className="gs-head">
        <span>Getting started</span>
        <button
          className="btn ghost icon-btn"
          aria-label="Dismiss"
          onClick={() => {
            localStorage.setItem(`${DISMISSED_KEY}.${scope}.${me._id}`, "1");
            setDismissed(true);
          }}
        >
          ✕
        </button>
      </div>
      {steps.map((step) => (
        <div key={step.key} className={`gs-step ${done(step) ? "done" : ""}`}>
          <span className="gs-check">{done(step) ? "✓" : "○"}</span>
          <div>
            <strong>{step.label}</strong>
            <span className="hint">{step.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

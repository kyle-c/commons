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

const STEPS: Record<"designer" | "pm" | "engineer", Step[]> = {
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
    { key: "project", label: "Put a repo on the canvas", detail: "+ New project, or connect GitHub and deployed repos appear on their own." },
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
export default function GettingStarted({ me, hasProjects }: { me: Doc<"users">; hasProjects: boolean }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(`${DISMISSED_KEY}.${me._id}`) === "1");
  const [, bump] = useState(0);
  useEffect(() => {
    const onFirst = () => bump((n) => n + 1);
    window.addEventListener("commons:first", onFirst);
    return () => window.removeEventListener("commons:first", onFirst);
  }, []);

  const role = me.orientation;
  if (!role || dismissed) return null;
  const steps = STEPS[role];
  const done = (step: Step) => (step.key === "project" ? hasProjects : hasFirst(step.key));
  if (steps.every(done)) return null;

  return (
    <div className="getting-started">
      <div className="gs-head">
        <span>Getting started</span>
        <button
          className="btn ghost icon-btn"
          aria-label="Dismiss"
          onClick={() => {
            localStorage.setItem(`${DISMISSED_KEY}.${me._id}`, "1");
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

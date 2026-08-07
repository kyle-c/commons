import { useEffect, useState } from "react";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import { hasFirst, type FirstKey } from "../lib/firsts";

const DISMISSED_KEY = "commons.gettingStartedDismissed";
const CELEBRATED_KEY = "commons.toolkitCelebrated";

/**
 * The quest ladder, made progressive (the author's correction: getting set
 * up, bringing people in, and speaking on the work are a JOURNEY, not a
 * grab-bag). Five phases; visible tips always come from the earliest phase
 * with work left, so nobody is taught what-ifs before they have a project,
 * or flow maps before they've commented. The role tunes ordering inside the
 * later phases only — the ladder itself is universal. Checks still come
 * only from doing the real thing (lib/firsts).
 */
interface Quest {
  key: FirstKey;
  label: string;
  detail: string;
  scope: "home" | "project";
  phase: number;
}

const PHASE_NAMES: Record<number, string> = {
  1: "Set up",
  2: "Bring people in",
  3: "Speak on the work",
  4: "Go deeper",
  5: "Master the map",
};

const POOL: Quest[] = [
  { key: "project", label: "Put a repo on the canvas", detail: "+ New project, or connect GitHub and deployed repos appear on their own.", scope: "home", phase: 1 },
  { key: "opened", label: "Open a project", detail: "Any card below — every screen in it is the real product, live.", scope: "home", phase: 1 },
  { key: "invite", label: "Invite a teammate", detail: "The Team menu (⌘T), or invite from a project's Share menu — the email carries the project.", scope: "home", phase: 2 },
  { key: "share", label: "Copy a share link", detail: "The share menu mints a link anyone can open — no account needed.", scope: "project", phase: 2 },
  { key: "comment", label: "Pin a comment", detail: "Press C, click the exact pixel, say the thing.", scope: "project", phase: 3 },
  { key: "reaction", label: "Place a sticker", detail: "Press S, pick a sticker, click exactly where you mean it.", scope: "project", phase: 3 },
  { key: "vote", label: "Spend a dot", detail: "Right-click a screen → ●. Five dots per project; spending one is a choice.", scope: "project", phase: 3 },
  { key: "whatif", label: "Ask what-if", detail: "Right-click a screen → ✦. An agent builds a live variant on a draft branch.", scope: "project", phase: 4 },
  { key: "agent", label: "Send a thread to the agent", detail: "Any comment thread → ⚡. The draft comes back with a preview link.", scope: "project", phase: 4 },
  { key: "prototype", label: "Try the prototype", detail: "The play tab runs the real app full-size.", scope: "project", phase: 4 },
  { key: "gif", label: "Throw a GIF", detail: "In sticker mode, 🎞️ — search, paste, or drop one where you aim.", scope: "project", phase: 4 },
  { key: "test", label: "Start a user test", detail: "Tasks go out as one link; results land back on the canvas.", scope: "project", phase: 4 },
  { key: "flow", label: "See the map", detail: "⌘3 — the whole app as a graph, drawn from real use.", scope: "project", phase: 5 },
  { key: "survey", label: "Survey your coverage", detail: "The ledger (G) walks your running app and finds screens the canvas lacks.", scope: "project", phase: 5 },
  { key: "narrate", label: "Approve a design note", detail: "Narrate (N) drafts the why behind each screen; nothing shows until you approve it.", scope: "project", phase: 5 },
];

/** Inside phases 4-5, the role's signature moves lead. */
const ROLE_LEAD: Record<"designer" | "pm" | "engineer", FirstKey[]> = {
  designer: ["whatif", "gif", "prototype"],
  pm: ["prototype", "test", "whatif"],
  engineer: ["agent", "whatif", "prototype"],
};

export default function GettingStarted({
  me,
  hasProjects,
  scope = "home",
}: {
  me: Doc<"users">;
  hasProjects: boolean;
  scope?: "home" | "project";
}) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(`${DISMISSED_KEY}.${scope}.${me._id}`) === "1");
  const [celebrated, setCelebrated] = useState(() => localStorage.getItem(`${CELEBRATED_KEY}.${me._id}`) === "1");
  const [, bump] = useState(0);
  useEffect(() => {
    const onFirst = () => bump((n) => n + 1);
    window.addEventListener("commons:first", onFirst);
    return () => window.removeEventListener("commons:first", onFirst);
  }, []);

  const role = me.orientation;
  if (!role || dismissed) return null;

  // Non-engineers may never add a repo; their pool must stay completable.
  const pool = POOL.filter((q) => (role === "engineer" ? true : q.key !== "project"));
  const done = (q: Quest) => (q.key === "project" ? hasProjects || hasFirst("project") : hasFirst(q.key));
  const lead = ROLE_LEAD[role];
  // Phase is the ladder; the role only reorders within a phase.
  const ordered = [...pool].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    const ai = lead.indexOf(a.key);
    const bi = lead.indexOf(b.key);
    return (ai === -1 ? lead.length : ai) - (bi === -1 ? lead.length : bi);
  });
  const doneCount = pool.filter(done).length;
  const allDone = doneCount === pool.length;
  const currentPhase = ordered.find((q) => !done(q))?.phase;

  if (allDone && celebrated) return null;
  if (allDone) {
    return (
      <div className={`getting-started ${scope === "project" ? "in-project" : ""}`}>
        <div className="gs-head">
          <span>
            {pool.length} of {pool.length} — you have used the whole toolkit 🎉
          </span>
          <button
            className="btn ghost"
            onClick={() => {
              localStorage.setItem(`${CELEBRATED_KEY}.${me._id}`, "1");
              setCelebrated(true);
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // 2-3 tips for THIS surface, in ladder order, held to the current phase
  // (+1, so a surface with no current-phase work teaches what's next
  // rather than nothing).
  const next = ordered
    .filter((q) => q.scope === scope && !done(q) && q.phase <= (currentPhase ?? 5) + 1)
    .slice(0, 3);
  if (next.length === 0) return null;
  const phaseName = PHASE_NAMES[next[0].phase];

  return (
    <div className={`getting-started ${scope === "project" ? "in-project" : ""}`}>
      <div className="gs-head">
        <span>
          Getting started<span className="gs-phase"> · {phaseName}</span>
        </span>
        <span className="gs-count">
          {doneCount} of {pool.length}
        </span>
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
      <div className="gs-track" aria-hidden>
        <span style={{ width: `${Math.round((doneCount / pool.length) * 100)}%` }} />
      </div>
      {next.map((quest) => (
        <div key={quest.key} className="gs-step">
          <span className="gs-check">○</span>
          <div>
            <strong>{quest.label}</strong>
            <span className="hint">{quest.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

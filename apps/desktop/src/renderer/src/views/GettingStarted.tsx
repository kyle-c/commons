import { useEffect, useState } from "react";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import { hasFirst, type FirstKey } from "../lib/firsts";

const DISMISSED_KEY = "commons.gettingStartedDismissed";
const CELEBRATED_KEY = "commons.toolkitCelebrated";

interface Quest {
  key: FirstKey;
  label: string;
  detail: string;
  scope: "home" | "project";
}

/**
 * The toolkit, as a quest pool (the author's ask: keep 2-3 tips visible,
 * refilling, until the high-value features have each been used once). One
 * master list; the chosen role floats its signature moves to the front but
 * everyone's pool is the whole product — the point is discovering the parts
 * you would not have guessed at. Checks still come only from doing.
 */
const POOL: Quest[] = [
  { key: "project", label: "Put a repo on the canvas", detail: "+ New project, or connect GitHub and deployed repos appear on their own.", scope: "home" },
  { key: "opened", label: "Open a project", detail: "Any card below — every screen in it is the real product, live.", scope: "home" },
  { key: "comment", label: "Pin a comment", detail: "Press C, click the exact pixel, say the thing.", scope: "project" },
  { key: "reaction", label: "Place a sticker", detail: "Press S, pick a sticker, click exactly where you mean it.", scope: "project" },
  { key: "vote", label: "Spend a dot", detail: "Right-click a screen → ●. Five dots per project; spending one is a choice.", scope: "project" },
  { key: "gif", label: "Throw a GIF", detail: "Right-click → 🎞️ — search, paste, or drop one where you aim.", scope: "project" },
  { key: "whatif", label: "Ask what-if", detail: "Right-click → ✦. An agent builds a live variant on a draft branch.", scope: "project" },
  { key: "agent", label: "Send a thread to the agent", detail: "Any comment thread → ⚡. The draft comes back with a preview link.", scope: "project" },
  { key: "prototype", label: "Try the prototype", detail: "The play tab runs the real app full-size.", scope: "project" },
  { key: "test", label: "Start a user test", detail: "Tasks go out as one link; results land back on the canvas.", scope: "project" },
  { key: "share", label: "Copy a share link", detail: "The share menu mints a link anyone can open — no account needed.", scope: "project" },
  { key: "flow", label: "See the map", detail: "⌘3 — the whole app as a graph, drawn from real use.", scope: "project" },
  { key: "survey", label: "Survey your coverage", detail: "The ledger (G) walks your running app and finds screens the canvas lacks.", scope: "project" },
  { key: "narrate", label: "Approve a design note", detail: "Narrate (N) drafts the why behind each screen; nothing shows until you approve it.", scope: "project" },
];

/** The role's signature moves float first; the rest keep pool order. */
const ROLE_LEAD: Record<"designer" | "pm" | "engineer", FirstKey[]> = {
  designer: ["comment", "reaction", "whatif"],
  pm: ["prototype", "reaction", "test"],
  engineer: ["project", "agent", "whatif"],
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
  const ordered = [...pool].sort((a, b) => {
    const ai = lead.indexOf(a.key);
    const bi = lead.indexOf(b.key);
    return (ai === -1 ? lead.length : ai) - (bi === -1 ? lead.length : bi);
  });
  const doneCount = pool.filter(done).length;
  const allDone = doneCount === pool.length;

  if (allDone && celebrated) return null;
  if (allDone) {
    // The finale shows wherever the last milestone landed, once, then never.
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

  // Always 2-3 tips for THIS surface: the next incomplete quests at this
  // scope, refilling as earlier ones complete.
  const next = ordered.filter((q) => q.scope === scope && !done(q)).slice(0, 3);
  if (next.length === 0) return null;

  return (
    <div className={`getting-started ${scope === "project" ? "in-project" : ""}`}>
      <div className="gs-head">
        <span>Getting started</span>
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

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import type { Nav } from "../App";
import { sessionToken, timeAgo } from "../lib/session";
import { registerShortcut } from "../lib/shortcuts";

/**
 * ⌘K: jump to any project from anywhere. Fuzzy-ish matching (prefix beats
 * substring), ordered by activity. Built to grow — frames, threads, and
 * actions can join the result list later without changing the shell.
 */
export default function CommandPalette({ me, setNav }: { me: Doc<"users">; setNav: (nav: Nav) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const projects = useQuery(
    api.projects.listWithActivity,
    open ? { userId: me._id, sessionToken: sessionToken() } : "skip"
  );

  useEffect(
    () =>
      registerShortcut(
        "k",
        () => {
          setOpen((o) => !o);
          setQuery("");
          setHighlighted(0);
        },
        { meta: true, description: "Jump to project" }
      ),
    []
  );

  const results = useMemo(() => {
    if (!projects) return [];
    const needle = query.trim().toLowerCase();
    const scored = projects
      .map((p) => {
        const name = p.name.toLowerCase();
        const score = !needle ? 1 : name.startsWith(needle) ? 3 : name.includes(needle) ? 2 : 0;
        return { p, score };
      })
      .filter((r) => r.score > 0);
    scored.sort((a, b) => b.score - a.score || (b.p.lastActivityAt ?? 0) - (a.p.lastActivityAt ?? 0));
    return scored.slice(0, 8).map((r) => r.p);
  }, [projects, query]);

  const pick = (project: (typeof results)[number]) => {
    setOpen(false);
    setNav({ screen: "project", projectId: project._id, view: "canvas" });
  };

  if (!open) return null;
  return (
    <div className="palette-overlay" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Jump to a project…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlighted(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && results[highlighted]) {
              pick(results[highlighted]);
            }
          }}
        />
        <div className="palette-results">
          {results.map((project, i) => (
            <button
              key={project._id}
              className={i === highlighted ? "hl" : ""}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => pick(project)}
            >
              <span className="palette-name">{project.name}</span>
              <span className="hint">
                {project.workspaceName ?? ""} · active {timeAgo(project.lastActivityAt ?? project._creationTime)} ago
              </span>
            </button>
          ))}
          {results.length === 0 && <div className="hint palette-empty">No projects match "{query}"</div>}
        </div>
      </div>
    </div>
  );
}

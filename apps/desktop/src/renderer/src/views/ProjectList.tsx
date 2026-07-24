import { useRef, useState } from "react";
import { useClickOutside } from "../lib/useClickOutside";
import { useQuery, useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { Nav } from "../App";
import { initials, timeAgo, sessionToken } from "../lib/session";
import { layoutFrames } from "../lib/frameLayout";
import GitSetupBanner from "./GitSetupBanner";
import { useMachineId } from "../lib/machine";

/** Stable color pair derived from the name, for repos with no detectable colors. */
function fallbackColors(name: string): [string, string] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const h = hash % 360;
  return [`hsl(${h}, 45%, 38%)`, `hsl(${(h + 45) % 360}, 50%, 26%)`];
}

/** Card cover: project name over a gradient of the repo's brand colors. */
function ProjectCover({ name, colors }: { name: string; colors?: string[] }) {
  const [c1, c2] =
    colors && colors.length >= 2
      ? [colors[0], colors[1]]
      : colors?.length === 1
        ? [colors[0], `color-mix(in srgb, ${colors[0]} 55%, #101012)`]
        : fallbackColors(name);
  return (
    <div className="project-cover" style={{ background: `linear-gradient(160deg, ${c1}, ${c2})` }}>
      <span>{name}</span>
    </div>
  );
}

export default function ProjectList({ me, setNav }: { me: Doc<"users">; setNav: (nav: Nav) => void }) {
  const projects = useQuery(api.projects.listWithActivity, { userId: me._id, sessionToken: sessionToken() });
  const machineId = useMachineId();
  const workspaces = useQuery(api.workspaces.mine, { userId: me._id, sessionToken: sessionToken() }) ?? [];
  const create = useMutation(api.projects.create);
  const linkRepo = useMutation(api.repoLinks.link);
  const [adding, setAdding] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(addMenuRef, () => setAddMenuOpen(false), addMenuOpen);

  const addProject = async (workspaceId: Id<"workspaces">) => {
    setAddMenuOpen(false);
    if (adding) return;
    if (!window.commons) {
      alert("Adding local repos needs the desktop app.");
      return;
    }
    setAdding(true);
    try {
      const inspection = await window.commons.pickRepo();
      if (!inspection) return;
      const projectId = await create({
        name: inspection.name,
        createdBy: me._id,
        workspaceId,
        visibility: "team",
        gitRemote: inspection.gitRemote,
        framework: inspection.framework,
        brandColors: inspection.brandColors,
        frames: layoutFrames(inspection),
      });
      // The creator's working copy is the one we just inspected.
      await linkRepo({ projectId, userId: me._id, repoPath: inspection.repoPath, machineId: machineId ?? undefined });
      setNav({ screen: "project", projectId, view: "canvas" });
    } finally {
      setAdding(false);
    }
  };

  const [query, setQuery] = useState("");

  // Grouped home: one section per workspace (playground first), so team apps
  // and personal apps never visually mix. Cards order by activity, not age.
  const sections = (() => {
    const needle = query.trim().toLowerCase();
    const visible = (projects ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle));
    const byWorkspace = new Map<string, { name: string; projects: NonNullable<typeof projects> }>();
    for (const project of visible) {
      const key = project.workspaceId ?? "unassigned";
      const name = project.workspaceName ?? "Unassigned";
      if (!byWorkspace.has(key)) byWorkspace.set(key, { name, projects: [] });
      byWorkspace.get(key)!.projects.push(project);
    }
    for (const section of byWorkspace.values()) {
      section.projects.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
    }
    const order = new Map(workspaces.map((w, i) => [w._id as string, i]));
    return [...byWorkspace.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
      .map(([key, section]) => ({ key, ...section }));
  })();

  return (
    <div className="home">
      <div className="home-header">
        <h1>Projects</h1>
        <input
          className="home-search"
          placeholder="Search projects…  (⌘K anywhere)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={{ position: "relative" }} ref={addMenuRef}>
          <button className="btn primary" onClick={() => setAddMenuOpen(!addMenuOpen)} disabled={adding}>
            {adding ? "Inspecting…" : "+ Add project"}
          </button>
          {addMenuOpen && (
            <div className="titlebar-popover popover-menu">
              {workspaces.map((workspace) => (
                <button key={workspace._id} onClick={() => addProject(workspace._id)}>
                  <strong>{workspace.name}</strong>
                  <span className="hint">
                    {workspace.kind === "personal"
                      ? "Just you — your playground"
                      : `${workspace.members.length} member${workspace.members.length === 1 ? "" : "s"}${workspace.domain ? ` · @${workspace.domain}` : ""}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <GitSetupBanner me={me} probeRemote={(projects ?? []).find((p) => p.gitRemote)?.gitRemote} />

      {projects && projects.length === 0 && (
        <div className="empty-state">
          No projects yet.
          <br />
          Point Commons at a local Next.js repo and its screens land on a shared canvas.
        </div>
      )}

      {sections.map((section) => (
        <div key={section.key} className="workspace-section">
          {sections.length > 1 && <h2 className="workspace-heading">{section.name}</h2>}
          <div className="project-grid">
            {section.projects.map((project) => (
          <button
            key={project._id}
            className="project-card"
            aria-label={`Open ${project.name}`}
            onClick={() => setNav({ screen: "project", projectId: project._id, view: "canvas" })}
          >
            <ProjectCover name={project.name} colors={project.brandColors} />
            <div className="meta">
              <span>
                {project.framework === "nextjs"
                  ? "Next.js"
                  : project.framework === "expo"
                    ? "Expo"
                    : project.framework === "vite"
                      ? "Vite"
                      : "Code"}
              </span>
              {project.visibility === "private" && <span>🔒 private</span>}
              {project.creator && project.creator._id !== me._id && <span>by {project.creator.name}</span>}
              <span>active {timeAgo(project.lastActivityAt ?? project._creationTime)} ago</span>
            </div>
            <div className="foot">
              <div style={{ display: "flex", gap: 6 }}>
                {project.frameCount === 0 ? (
                  <span
                    className="badge setup"
                    title="Discovery found no screens — add a commons.json (dev command + route list) to light this project up"
                  >
                    needs setup
                  </span>
                ) : (
                  <span className="badge">{project.frameCount} frames</span>
                )}
                {project.openThreadCount > 0 && (
                  <span className="badge comments">{project.openThreadCount} open threads</span>
                )}
              </div>
              <div className="avatar-stack">
                {project.activeUsers.map(
                  (user) =>
                    user && (
                      <span
                        key={user._id}
                        className="avatar"
                        style={{ background: user.avatarColor }}
                        title={`${user.name} is here now`}
                      >
                        {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}
                      </span>
                    )
                )}
              </div>
            </div>
          </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

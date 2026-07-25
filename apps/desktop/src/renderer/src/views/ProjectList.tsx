import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { Nav } from "../App";
import { initials, timeAgo, sessionToken } from "../lib/session";
import { layoutFrames } from "../lib/frameLayout";
import GitSetupBanner from "./GitSetupBanner";
import { useMachineId } from "../lib/machine";
import ThemeToggle from "./ThemeToggle";
import ServersMenu from "./ServersMenu";
import WorkspacesMenu from "./WorkspacesMenu";
import Team from "./Team";
import Inbox from "./Inbox";
import AccountMenu from "./AccountMenu";
import Icon from "../components/icons";

/** Stable color pair derived from the name, for repos with no detectable colors. */
function fallbackColors(name: string): [string, string] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const h = hash % 360;
  return [`hsl(${h}, 45%, 38%)`, `hsl(${(h + 45) % 360}, 50%, 26%)`];
}

/** Card cover: project name over a gradient of the repo's brand colors.
 *  Children (the inline rename input) replace the name while editing. */
function ProjectCover({ name, colors, children }: { name: string; colors?: string[]; children?: React.ReactNode }) {
  const [c1, c2] =
    colors && colors.length >= 2
      ? [colors[0], colors[1]]
      : colors?.length === 1
        ? [colors[0], `color-mix(in srgb, ${colors[0]} 55%, #101012)`]
        : fallbackColors(name);
  return (
    <div className="project-cover" style={{ background: `linear-gradient(160deg, ${c1}, ${c2})` }}>
      {children ?? <span>{name}</span>}
    </div>
  );
}

export default function ProjectList({
  me,
  setNav,
  onSignOut,
}: {
  me: Doc<"users">;
  setNav: (nav: Nav) => void;
  onSignOut: () => void;
}) {
  const projects = useQuery(api.projects.listWithActivity, { userId: me._id, sessionToken: sessionToken() });
  const machineId = useMachineId();
  const workspaces = useQuery(api.workspaces.mine, { userId: me._id, sessionToken: sessionToken() }) ?? [];
  const create = useMutation(api.projects.create);
  const linkRepo = useMutation(api.repoLinks.link);
  const renameProject = useMutation(api.projects.rename);
  const [adding, setAdding] = useState(false);
  // Inline rename, entered from the card's hover pen. Enter/blur commit,
  // Esc cancels; committing a no-op or empty value just closes the field.
  const [renaming, setRenaming] = useState<{ id: Id<"projects">; value: string; original: string } | null>(null);
  const commitRename = async () => {
    if (!renaming) return;
    const { id, value, original } = renaming;
    setRenaming(null);
    const name = value.trim();
    if (!name || name === original) return;
    await renameProject({ projectId: id, name, userId: me._id, sessionToken: sessionToken() }).catch(() => {});
  };

  const addProject = async (workspaceId: Id<"workspaces">) => {
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
  // Every workspace gets a section even when empty — its section is where
  // the "+ New project" tile lives (creation happens where the project will
  // land, so nobody answers a which-workspace menu).
  const sections = (() => {
    const needle = query.trim().toLowerCase();
    const visible = (projects ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle));
    const byWorkspace = new Map<string, { name: string; projects: NonNullable<typeof projects> }>();
    if (!needle && projects !== undefined) {
      for (const workspace of workspaces) byWorkspace.set(workspace._id, { name: workspace.name, projects: [] });
    }
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
    <div className="app">
      {/* The home's titlebar: search centered like a macOS toolbar; creation
          lives down in the grid where the project will actually land. */}
      <div className="titlebar">
        <span className="wordmark">Commons</span>
        <span className="spacer" />
        <input
          className="titlebar-search centered"
          placeholder="Search projects…  ⌘K"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ServersMenu />
        <ThemeToggle />
        <WorkspacesMenu me={me} />
        <Team me={me} />
        <Inbox me={me} setNav={setNav} />
        <AccountMenu me={me} onSignOut={onSignOut} />
      </div>
      <div className="home">
      <div className="home-header">
        <h1>Projects</h1>
      </div>

      <GitSetupBanner me={me} probeRemote={(projects ?? []).find((p) => p.gitRemote)?.gitRemote} />

      {projects === undefined && (
        // Perceived speed: the grid's shape lands before the data does.
        <div className="project-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="project-card skeleton-card" aria-hidden>
              <div className="project-cover skeleton" />
              <div className="skeleton" style={{ height: 14, width: "55%" }} />
              <div className="skeleton" style={{ height: 20, width: "40%" }} />
            </div>
          ))}
        </div>
      )}

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
          <div
            key={project._id}
            className="project-card"
            role="button"
            tabIndex={0}
            aria-label={`Open ${project.name}`}
            onClick={() => setNav({ screen: "project", projectId: project._id, view: "canvas" })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renaming?.id !== project._id) {
                setNav({ screen: "project", projectId: project._id, view: "canvas" });
              }
            }}
          >
            <ProjectCover name={project.name} colors={project.brandColors}>
              {renaming?.id === project._id ? (
                <input
                  className="cover-rename"
                  autoFocus
                  value={renaming.value}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") void commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : undefined}
            </ProjectCover>
            <button
              className="btn ghost icon-btn card-edit"
              aria-label={`Rename ${project.name}`}
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                setRenaming({ id: project._id, value: project.name, original: project.name });
              }}
            >
              <Icon name="pen" size={13} />
            </button>
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
          </div>
            ))}
            {section.key !== "unassigned" && !query.trim() && (
              <button
                className="new-project-tile"
                disabled={adding}
                onClick={() => void addProject(section.key as Id<"workspaces">)}
              >
                <strong>{adding ? "Inspecting…" : "+ New project"}</strong>
                <span className="hint">
                  {window.commons ? "Point Commons at a local repo" : "Needs the desktop app"}
                </span>
              </button>
            )}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

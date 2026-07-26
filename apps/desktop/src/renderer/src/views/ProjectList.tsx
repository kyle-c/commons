import { useRef, useState } from "react";
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

/** Shared lifecycle labels: what kind of feedback a project wants right now. */
const STATUSES = [
  { value: "exploring", label: "Exploring", color: "#5b8def" },
  { value: "in-review", label: "In review", color: "#e0a03f" },
  { value: "testing", label: "Testing", color: "#a78bfa" },
  { value: "shipped", label: "Shipped", color: "#4bb885" },
  { value: "parked", label: "Parked", color: "#8b8b94" },
] as const;
type ProjectStatus = (typeof STATUSES)[number]["value"];

/** Stable color pair derived from the name, for repos with no detectable colors. */
function fallbackColors(name: string): [string, string] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const h = hash % 360;
  return [`hsl(${h}, 45%, 38%)`, `hsl(${(h + 45) % 360}, 50%, 26%)`];
}

/** Card cover: project name over a gradient of the repo's brand colors.
 *  Children (the inline rename input) replace the name while editing. */
function ProjectCover({
  name,
  colors,
  coverUrl,
  children,
}: {
  name: string;
  colors?: string[];
  coverUrl?: string | null;
  children?: React.ReactNode;
}) {
  const [c1, c2] =
    colors && colors.length >= 2
      ? [colors[0], colors[1]]
      : colors?.length === 1
        ? [colors[0], `color-mix(in srgb, ${colors[0]} 55%, #101012)`]
        : fallbackColors(name);
  return (
    <div className="project-cover" style={coverUrl ? undefined : { background: `linear-gradient(160deg, ${c1}, ${c2})` }}>
      {coverUrl && <img className="cover-img" src={coverUrl} alt="" />}
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
  const setCover = useMutation(api.projects.setCover);
  const togglePin = useMutation(api.projects.togglePin);
  const setArchived = useMutation(api.projects.setArchived);
  const setStatus = useMutation(api.projects.setStatus);
  const [statusMenuFor, setStatusMenuFor] = useState<Id<"projects"> | null>(null);
  const [archivedOpen, setArchivedOpen] = useState<Record<string, boolean>>({});
  const generateUploadUrl = useMutation(api.comments.generateUploadUrl);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverTarget, setCoverTarget] = useState<Id<"projects"> | null>(null);
  const uploadCover = async (file: File) => {
    if (!coverTarget) return;
    const url = await generateUploadUrl();
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    await setCover({ projectId: coverTarget, storageId, userId: me._id, sessionToken: sessionToken() });
  };
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
    const byWorkspace = new Map<
      string,
      { name: string; projects: NonNullable<typeof projects>; archived: NonNullable<typeof projects> }
    >();
    if (!needle && projects !== undefined) {
      for (const workspace of workspaces) {
        byWorkspace.set(workspace._id, { name: workspace.name, projects: [], archived: [] });
      }
    }
    for (const project of visible) {
      const key = project.workspaceId ?? "unassigned";
      const name = project.workspaceName ?? "Unassigned";
      if (!byWorkspace.has(key)) byWorkspace.set(key, { name, projects: [], archived: [] });
      byWorkspace.get(key)![project.archivedAt ? "archived" : "projects"].push(project);
    }
    for (const section of byWorkspace.values()) {
      // Pins float to the front of their section; activity orders the rest.
      section.projects.sort(
        (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
      );
      section.archived.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
    }
    const order = new Map(workspaces.map((w, i) => [w._id as string, i]));
    return [...byWorkspace.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
      .map(([key, section]) => ({ key, ...section }));
  })();

  // "Needs you": projects where teammates opened threads since your last
  // visit. Self-clearing — going back to the project advances your visit
  // marker and the entry drops out.
  const needsYou = (projects ?? [])
    .filter((p) => !p.archivedAt && (p.newThreadsSinceVisit ?? 0) > 0)
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

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
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void uploadCover(file);
        }}
      />
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

      {needsYou.length > 0 && !query.trim() && (
        <div className="needs-you">
          <h2 className="workspace-heading">Needs you</h2>
          <div className="needs-you-row">
            {needsYou.map((project) => {
              const [c1, c2] =
                project.brandColors && project.brandColors.length >= 2
                  ? [project.brandColors[0], project.brandColors[1]]
                  : fallbackColors(project.name);
              return (
                <button
                  key={project._id}
                  className="needs-you-card"
                  onClick={() => setNav({ screen: "project", projectId: project._id, view: "canvas" })}
                >
                  <span
                    className="ny-swatch"
                    style={
                      project.coverUrl
                        ? { backgroundImage: `url(${project.coverUrl})`, backgroundSize: "cover" }
                        : { background: `linear-gradient(160deg, ${c1}, ${c2})` }
                    }
                  />
                  <span className="ny-name">{project.name}</span>
                  <span className="ny-reason">
                    {project.newThreadsSinceVisit} new thread{project.newThreadsSinceVisit === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
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
            <ProjectCover name={project.name} colors={project.brandColors} coverUrl={project.coverUrl}>
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
            <span className="card-actions">
              <button
                className={`btn ghost icon-btn card-edit ${project.pinned ? "pinned" : ""}`}
                aria-label={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
                title={project.pinned ? "Unpin" : "Pin to top"}
                onClick={(e) => {
                  e.stopPropagation();
                  void togglePin({ projectId: project._id, userId: me._id, sessionToken: sessionToken() });
                }}
              >
                <Icon name="pin" size={13} />
              </button>
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
              <button
                className="btn ghost icon-btn card-edit"
                aria-label={`Change ${project.name}'s cover image`}
                title="Cover image"
                onClick={(e) => {
                  e.stopPropagation();
                  setCoverTarget(project._id);
                  coverInputRef.current?.click();
                }}
              >
                <Icon name="image" size={13} />
              </button>
              <button
                className="btn ghost icon-btn card-edit"
                aria-label={`Archive ${project.name}`}
                title="Archive (share links stay alive)"
                onClick={(e) => {
                  e.stopPropagation();
                  void setArchived({ projectId: project._id, archived: true, userId: me._id, sessionToken: sessionToken() });
                }}
              >
                <Icon name="archive" size={13} />
              </button>
            </span>
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
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className="status-wrap" onClick={(e) => e.stopPropagation()}>
                  {(() => {
                    const current = STATUSES.find((s) => s.value === project.status);
                    return (
                      <button
                        className={`status-chip ${current ? "" : "unset"}`}
                        title="Project status: tells teammates what feedback is wanted"
                        onClick={() => setStatusMenuFor(statusMenuFor === project._id ? null : project._id)}
                      >
                        {current ? (
                          <>
                            <span className="status-swatch" style={{ background: current.color }} />
                            {current.label}
                          </>
                        ) : (
                          "+ Status"
                        )}
                      </button>
                    );
                  })()}
                  {statusMenuFor === project._id && (
                    <>
                      <span className="menu-backdrop" onClick={() => setStatusMenuFor(null)} />
                      <span className="status-menu">
                        {STATUSES.map((s) => (
                          <button
                            key={s.value}
                            className={project.status === s.value ? "on" : ""}
                            onClick={() => {
                              setStatusMenuFor(null);
                              void setStatus({
                                projectId: project._id,
                                status: (project.status === s.value ? undefined : s.value) as
                                  | ProjectStatus
                                  | undefined,
                                userId: me._id,
                                sessionToken: sessionToken(),
                              });
                            }}
                          >
                            <span className="status-swatch" style={{ background: s.color }} />
                            {s.label}
                          </button>
                        ))}
                      </span>
                    </>
                  )}
                </span>
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
          {section.archived.length > 0 && (
            <>
              <button
                className="archived-toggle"
                onClick={() => setArchivedOpen({ ...archivedOpen, [section.key]: !archivedOpen[section.key] })}
              >
                <Icon name="chevron" size={12} />
                Archived · {section.archived.length}
              </button>
              {archivedOpen[section.key] && (
                <div className="project-grid archived-grid">
                  {section.archived.map((project) => (
                    <div
                      key={project._id}
                      className="project-card archived"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${project.name} (archived)`}
                      onClick={() => setNav({ screen: "project", projectId: project._id, view: "canvas" })}
                    >
                      <ProjectCover name={project.name} colors={project.brandColors} coverUrl={project.coverUrl} />
                      <div className="meta">
                        <span>archived {timeAgo(project.archivedAt ?? 0)} ago</span>
                        <button
                          className="btn ghost restore-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            void setArchived({
                              projectId: project._id,
                              archived: false,
                              userId: me._id,
                              sessionToken: sessionToken(),
                            });
                          }}
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}

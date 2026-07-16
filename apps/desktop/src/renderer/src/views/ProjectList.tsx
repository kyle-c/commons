import { useRef, useState } from "react";
import { useClickOutside } from "../lib/useClickOutside";
import { useQuery, useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import type { Nav } from "../App";
import { initials, timeAgo } from "../lib/session";
import { layoutFrames } from "../lib/frameLayout";
import GitSetupBanner from "./GitSetupBanner";

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
  const projects = useQuery(api.projects.listWithActivity, { userId: me._id });
  const create = useMutation(api.projects.create);
  const linkRepo = useMutation(api.repoLinks.link);
  const [adding, setAdding] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(addMenuRef, () => setAddMenuOpen(false), addMenuOpen);

  const addProject = async (visibility: "team" | "private") => {
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
        visibility,
        gitRemote: inspection.gitRemote,
        framework: inspection.framework,
        brandColors: inspection.brandColors,
        frames: layoutFrames(inspection),
      });
      // The creator's working copy is the one we just inspected.
      await linkRepo({ projectId, userId: me._id, repoPath: inspection.repoPath });
      setNav({ screen: "project", projectId, view: "canvas" });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="home">
      <div className="home-header">
        <h1>Projects</h1>
        <div style={{ position: "relative" }} ref={addMenuRef}>
          <button className="btn primary" onClick={() => setAddMenuOpen(!addMenuOpen)} disabled={adding}>
            {adding ? "Inspecting…" : "+ Add project"}
          </button>
          {addMenuOpen && (
            <div className="titlebar-popover popover-menu">
              <button onClick={() => addProject("team")}>
                <strong>Team project</strong>
                <span className="hint">Everyone on the team can see it</span>
              </button>
              <button onClick={() => addProject("private")}>
                <strong>Private project</strong>
                <span className="hint">Just you, until you add members</span>
              </button>
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

      <div className="project-grid">
        {(projects ?? []).map((project) => (
          <button
            key={project._id}
            className="project-card"
            onClick={() => setNav({ screen: "project", projectId: project._id, view: "canvas" })}
          >
            <ProjectCover name={project.name} colors={project.brandColors} />
            <div className="name">{project.name}</div>
            <div className="meta">
              <span>
                {project.framework === "nextjs" ? "Next.js" : project.framework === "expo" ? "Expo" : "Code"}
              </span>
              {project.visibility === "private" && <span>🔒 private</span>}
              <span>by {project.creator?.name ?? "unknown"}</span>
              <span>{timeAgo(project._creationTime)} ago</span>
            </div>
            <div className="foot">
              <div style={{ display: "flex", gap: 6 }}>
                <span className="badge">{project.frameCount} frames</span>
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
  );
}

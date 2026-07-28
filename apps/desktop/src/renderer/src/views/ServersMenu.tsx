import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { DevServerStatus } from "@commons/shared";
import { useClickOutside } from "../lib/useClickOutside";
import { useMachineId } from "../lib/machine";
import { sessionToken } from "../lib/session";
import Icon from "../components/icons";
import { PopSection } from "../components/popover";

interface ServerRow {
  repoPath: string;
  name?: string;
  status: DevServerStatus;
}

/**
 * The port viewer: every dev server this app instance owns — online/offline
 * dot, prototype name, port, and where it lives on disk. Desktop only.
 *
 * Doubles as a switcher: the rows are the running things, so clicking one
 * should take you to it rather than making you find it on the home screen.
 */
export default function ServersMenu({
  me,
  onOpenProject,
}: {
  me?: Doc<"users">;
  /** Jump to a project's prototype view. Absent = rows stay informational. */
  onOpenProject?: (projectId: Id<"projects">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const machineId = useMachineId();
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  // A dev server is known by its path; the switcher needs the project behind
  // it. Only fetched while the menu is open.
  const links = useQuery(
    api.repoLinks.mine,
    open && me ? { userId: me._id, sessionToken: sessionToken(), machineId: machineId ?? undefined } : "skip"
  );
  const projectByPath = new Map((links ?? []).map((l) => [l.repoPath, l.projectId]));

  const refresh = () => {
    void window.commons?.listDevServers().then(setServers);
  };

  // Badge stays honest even while closed; status pushes keep it live.
  useEffect(() => {
    if (!window.commons) return;
    refresh();
    return window.commons.onDevServerStatus(refresh);
  }, []);

  if (!window.commons) return null;
  const online = servers.filter((s) => s.status.state === "ready").length;

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ghost icon-btn ${open ? "active" : ""}`}
        aria-label="Running prototypes"
        title="Running prototypes and their ports"
        onClick={() => {
          refresh();
          setOpen(!open);
        }}
      >
        <Icon name="monitor" />
        {online > 0 && <span className="count-badge live">{online}</span>}
      </button>
      {open && (
        <div className="titlebar-popover">
          <PopSection label={`Running prototypes · ${online}`} />
          {servers.length === 0 && (
            <div className="hint" style={{ padding: "0 14px 10px" }}>
              Nothing running — opening a project starts its server.
            </div>
          )}
          {servers.map((server) => {
            const projectId = projectByPath.get(server.repoPath);
            const canOpen = Boolean(projectId && onOpenProject);
            return (
            <div key={server.repoPath} className="server-row">
              <span
                className={`status-dot ${server.status.state === "ready" ? "ready" : server.status.state === "starting" ? "starting" : server.status.state === "error" ? "error" : ""}`}
              />
              <button
                className={`who server-open ${canOpen ? "" : "plain"}`}
                disabled={!canOpen}
                title={canOpen ? "Open this prototype" : server.repoPath}
                onClick={() => {
                  if (!projectId || !onOpenProject) return;
                  onOpenProject(projectId);
                  setOpen(false);
                }}
              >
                <span className="name">
                  {server.name ?? server.repoPath.split("/").pop()}
                  {"port" in server.status && <span className="server-port"> · :{server.status.port}</span>}
                </span>
                <span className="email">{server.repoPath}</span>
              </button>
              <button
                className="btn ghost quiet-action"
                title="Stop this dev server and free its port"
                onClick={async () => {
                  await window.commons.stopDevServer(server.repoPath);
                  refresh();
                }}
              >
                Stop
              </button>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

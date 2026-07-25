import { useEffect, useRef, useState } from "react";
import type { DevServerStatus } from "@commons/shared";
import { useClickOutside } from "../lib/useClickOutside";
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
 */
export default function ServersMenu() {
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

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
              Nothing running. Open a project with its code on this Mac and its server starts here.
            </div>
          )}
          {servers.map((server) => (
            <div key={server.repoPath} className="server-row">
              <span
                className={`status-dot ${server.status.state === "ready" ? "ready" : server.status.state === "starting" ? "starting" : server.status.state === "error" ? "error" : ""}`}
              />
              <span className="who">
                <span className="name">
                  {server.name ?? server.repoPath.split("/").pop()}
                  {"port" in server.status && <span className="server-port"> · :{server.status.port}</span>}
                </span>
                <span className="email">{server.repoPath}</span>
              </span>
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
          ))}
        </div>
      )}
    </div>
  );
}

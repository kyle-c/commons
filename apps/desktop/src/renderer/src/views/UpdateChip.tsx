import { useEffect, useState } from "react";
import type { UpdateStatus } from "@commons/shared";

/**
 * Floating "update ready" pill. electron-updater downloads in the background
 * (main/updater.ts); once it's staged, this offers the one-click restart.
 * Renders nothing in dev builds or while up to date.
 */
export default function UpdateChip() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "none" });

  useEffect(() => {
    if (!window.commons) return;
    window.commons.getUpdateStatus().then(setStatus).catch(() => {});
    return window.commons.onUpdateStatus(setStatus);
  }, []);

  if (status.state !== "ready") return null;
  return (
    <div className="update-chip">
      <span>Commons {status.version} is ready</span>
      <button className="btn primary" onClick={() => void window.commons.installUpdate()}>
        Restart to update
      </button>
    </div>
  );
}

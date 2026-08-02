import { useEffect, useRef, useState } from "react";
import type { UpdateStatus } from "@commons/shared";

/**
 * The app's entire update UI: one floating pill.
 *
 * It narrates whatever the updater is doing — checking, downloading, staged
 * and ready — whether the check came from the menu or the hourly background
 * loop. "Ready" is the only state that stays: it is the only one with an
 * action attached. The informational outcomes (up to date, couldn't check,
 * dev build) excuse themselves after a beat, because a status that needed
 * dismissing would be a dialog wearing a different hat — which is exactly
 * what this replaced.
 */

/** How long a purely informational state hangs around before leaving. */
const TRANSIENT_MS = 5000;
const TRANSIENT: UpdateStatus["state"][] = ["current", "error", "dev"];

export default function UpdateChip() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "none" });
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!window.commons) return;
    window.commons.getUpdateStatus().then(setStatus).catch(() => {});
    return window.commons.onUpdateStatus(setStatus);
  }, []);

  useEffect(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (!TRANSIENT.includes(status.state)) return;
    dismissTimer.current = setTimeout(() => setStatus({ state: "none" }), TRANSIENT_MS);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [status]);

  if (status.state === "none") return null;

  if (status.state === "ready") {
    return (
      <div className="update-chip">
        <span>Commons {status.version} is ready</span>
        <button className="btn primary" onClick={() => void window.commons.installUpdate()}>
          Restart to update
        </button>
      </div>
    );
  }

  const line =
    status.state === "checking"
      ? "Checking for updates…"
      : status.state === "downloading"
        ? `Commons ${status.version} is on its way…`
        : status.state === "current"
          ? `You're up to date — Commons ${status.version}`
          : status.state === "error"
            ? "Couldn't reach the update feed. It'll retry on its own."
            : "Updates apply to installed builds; this is a dev run.";

  return (
    <div className="update-chip quiet">
      <span>{line}</span>
    </div>
  );
}

import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "@commons/shared";

/**
 * Auto-update against the feed the prod Convex deployment serves at
 * /update/* (see packages/backend/convex/updates.ts). The feed URL is baked
 * by electron-builder's `publish` config into app-update.yml, so packaged
 * builds need no code-side URL. Dev builds are a no-op.
 *
 * Flow: check on launch + every 4h → download in the background → tell the
 * renderer "ready" → it shows a restart chip → quitAndInstall.
 */

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let notify: ((status: UpdateStatus) => void) | null = null;
let updateReady = false;

export function start(onStatus: (status: UpdateStatus) => void): void {
  notify = onStatus;
  if (!app.isPackaged) return; // dev builds run from source; nothing to update

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    notify?.({ state: "ready", version: info.version });
  });
  autoUpdater.on("error", (err) => {
    // Update failures must never bother the user — the app they have works.
    console.warn("auto-update:", err.message);
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  void check();
  setInterval(check, CHECK_INTERVAL_MS);
}

/** Current status for late-subscribing renderers (window reloads). */
export function status(): UpdateStatus {
  return updateReady ? { state: "ready", version: autoUpdater.currentVersion.version } : { state: "none" };
}

export function installNow(): void {
  if (updateReady) autoUpdater.quitAndInstall();
}

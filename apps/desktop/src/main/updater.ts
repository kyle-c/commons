import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "@commons/shared";

/**
 * Auto-update against the feed the prod Convex deployment serves at
 * /update/* (see packages/backend/convex/updates.ts). The feed URL is baked
 * by electron-builder's `publish` config into app-update.yml, so packaged
 * builds need no code-side URL. Dev builds are a no-op.
 *
 * Flow: check on launch + hourly → download in the background → tell the
 * renderer → it shows the chip → quitAndInstall.
 *
 * Everything speaks through the chip. "Check for Updates…" used to open a
 * modal conversation while the background loop used the chip, which meant two
 * UIs for one fact depending on who asked. Now the menu item just runs a
 * check and the chip narrates it — with one asymmetry: outcomes that mean
 * "nothing happened" (up to date, offline, dev build) are only shown for
 * checks a person asked for. The background loop stays silent unless it has
 * an actual release in hand, so the chip never appears on its own to say
 * there is nothing to say.
 */

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let notify: ((status: UpdateStatus) => void) | null = null;
let updateReady = false;
let readyVersion = "";
/** Whether the in-flight check came from the menu, so quiet outcomes report. */
let userInitiated = false;

export function start(onStatus: (status: UpdateStatus) => void): void {
  notify = onStatus;
  if (!app.isPackaged) return; // dev builds run from source; nothing to update

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // A release exists: say so the moment the download starts, not only once it
  // lands. The chip is the app's whole update UI, so "on its way" is worth a
  // line — and for a menu check it is the answer to the question asked.
  autoUpdater.on("update-available", (info) => {
    userInitiated = false;
    notify?.({ state: "downloading", version: info.version });
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    readyVersion = info.version;
    notify?.({ state: "ready", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    if (userInitiated) notify?.({ state: "current", version: app.getVersion() });
    userInitiated = false;
  });
  autoUpdater.on("error", (err) => {
    // Background failures must never bother the user — the app they have
    // works. A person who explicitly asked gets an honest "couldn't check"
    // rather than a fabricated "you're up to date".
    if (userInitiated) notify?.({ state: "error" });
    userInitiated = false;
    console.warn("auto-update:", err.message);
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  void check();
  setInterval(check, CHECK_INTERVAL_MS);
}

/** Current status for late-subscribing renderers (window reloads). */
export function status(): UpdateStatus {
  return updateReady ? { state: "ready", version: readyVersion } : { state: "none" };
}

export function installNow(): void {
  if (updateReady) autoUpdater.quitAndInstall();
}

/**
 * Menu-triggered check. Fire-and-forget: every outcome arrives as a chip
 * state through the same channel the background loop uses.
 */
export function checkNow(): void {
  if (!app.isPackaged) {
    notify?.({ state: "dev" });
    return;
  }
  if (updateReady) {
    // Already staged — re-announce, so the chip reappears if it was missed.
    notify?.({ state: "ready", version: readyVersion });
    return;
  }
  userInitiated = true;
  notify?.({ state: "checking" });
  autoUpdater.checkForUpdates().catch(() => {
    // The error event above may not fire for rejections; answer the person.
    if (userInitiated) notify?.({ state: "error" });
    userInitiated = false;
  });
}

import { BrowserWindow } from "electron";

/**
 * Frame snapshots (SNAP-1): render a URL in an offscreen window and capture a
 * PNG. Used for the agent before/after images — "before" from the current
 * preview, "after" from the draft branch's deploy preview once it's live.
 *
 * Captures run serially: they're rare, and parallel offscreen Chromiums would
 * fight the dev server for CPU right when the team is watching a session.
 */

const SETTLE_MS = 1800; // fonts, images, above-the-fold animations
const LOAD_TIMEOUT_MS = 30_000;

let queue: Promise<unknown> = Promise.resolve();

export function capture(url: string, size: { width: number; height: number }): Promise<Buffer> {
  const job = queue.then(() => captureNow(url, size));
  // Keep the chain alive whether or not this capture fails.
  queue = job.catch(() => {});
  return job;
}

async function captureNow(url: string, size: { width: number; height: number }): Promise<Buffer> {
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    webPreferences: { offscreen: true, sandbox: true },
  });
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("snapshot load timed out")), LOAD_TIMEOUT_MS)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const image = await win.webContents.capturePage();
    return image.toPNG();
  } finally {
    win.destroy();
  }
}

/**
 * Wait for a draft branch's deploy preview to come alive (Vercel builds after
 * the push). Resolves true once the URL returns 200, false on timeout.
 */
export async function waitForDeploy(url: string, timeoutMs = 5 * 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // First build usually lands in 1–3 min; back off gently.
  let delay = 15_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      if (res.ok) {
        // One extra beat: the very first 200 can race static asset propagation.
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return true;
      }
    } catch {
      // DNS for the branch subdomain may not exist yet — keep polling.
    }
    delay = Math.min(delay * 1.5, 45_000);
  }
  return false;
}

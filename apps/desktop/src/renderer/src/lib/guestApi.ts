/**
 * Guest writes: the two things someone with only a share link can do.
 *
 * These go through the same token-gated HTTP endpoints the old share page
 * used, rather than new public Convex mutations, for one load-bearing reason:
 * the endpoints already exist, are already capped and gated on the share
 * token, and were already reviewed. The canvas subscribes to
 * projects.sharePage, so a successful write repaints the thread live without
 * any bookkeeping here.
 *
 * Relative fetch is deliberate: guest mode only exists in the browser, served
 * by the same deployment that hosts these endpoints, so the origin is always
 * right and nothing needs configuring.
 */

const NAME_KEY = "commons.guestName";

export function storedGuestName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberGuestName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private windows may refuse; asking again next time is fine.
  }
}

export async function postGuestThread(
  token: string,
  args: {
    name: string;
    body: string;
    frameId?: string;
    fx?: number;
    fy?: number;
    canvasX?: number;
    canvasY?: number;
  }
): Promise<string | null> {
  try {
    const response = await fetch("/api/p/thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...args }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { threadId?: string };
    return data.threadId ?? null;
  } catch {
    return null;
  }
}

export async function postGuestReply(
  token: string,
  args: { threadId: string; name: string; body: string }
): Promise<boolean> {
  try {
    const response = await fetch("/api/p/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...args }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

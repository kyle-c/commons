import { getConvexUrl, getStoredSession } from "./session";

/**
 * Crash/error reporting (#3): posts to the deployment's /api/error route so
 * a bad over-the-air release is noticed before a teammate reports a blank
 * screen. Fire-and-forget — reporting must never cause its own failure loop.
 */

let appVersion = "dev";

function endpoint(): string | null {
  const url = getConvexUrl();
  return url ? `${url.replace(".convex.cloud", ".convex.site")}/api/error` : null;
}

export function reportError(surface: "main" | "renderer" | "react", message: string, stack?: string): void {
  const url = endpoint();
  if (!url) return;
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: appVersion,
        surface,
        message,
        stack,
        email: getStoredSession() ? undefined : undefined, // identity comes from triage, not the report
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never throw from the reporter
  }
}

/** Install global handlers; call once at renderer startup. */
export function initErrorReporting(): void {
  if (window.commons) {
    window.commons.getAppVersion().then((v) => (appVersion = v)).catch(() => {});
    window.commons.onMainError((message, stack) => reportError("main", message, stack));
  }
  window.addEventListener("error", (event) => {
    reportError("renderer", event.message ?? "unknown error", event.error?.stack);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportError(
      "renderer",
      reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection"),
      reason instanceof Error ? reason.stack : undefined
    );
  });
}

import http from "http";
import net from "net";

/**
 * Tiny local server that frames a dev-server URL at device dimensions, so
 * "Open in browser" can carry the project's form factor (a phone app opens
 * phone-sized, not full-bleed). Serves only a wrapper page; the target must
 * be a localhost URL.
 */

let server: http.Server | null = null;
let port: number | null = null;

async function findFreePort(start: number): Promise<number> {
  for (let candidate = start; candidate < start + 100; candidate++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("No free port for the preview harness");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isLocalTarget(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function page(target: string, width: number, height: number, title: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — Commons preview</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px; background: #101012;
    font: 12px -apple-system, BlinkMacSystemFont, sans-serif; color: #9d9da6;
  }
  .device {
    width: ${width}px; height: ${height}px; max-height: calc(100vh - 72px);
    background: #fff; border: 1px solid #3d3d44; border-radius: 28px; overflow: hidden;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  }
  iframe { width: 100%; height: 100%; border: 0; }
  .meta a { color: #5aa2ff; text-decoration: none; margin-left: 8px; }
</style>
</head>
<body>
  <div class="device"><iframe src="${escapeHtml(target)}" title="${escapeHtml(title)}"></iframe></div>
  <div class="meta">${escapeHtml(title)} · ${width}×${height}<a href="${escapeHtml(target)}">open unframed →</a></div>
</body>
</html>`;
}

async function ensureServer(): Promise<number> {
  if (server && port) return port;
  port = await findFreePort(4210);
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const target = url.searchParams.get("url") ?? "";
    const width = Math.min(2000, Math.max(200, Number(url.searchParams.get("w")) || 390));
    const height = Math.min(2000, Math.max(300, Number(url.searchParams.get("h")) || 844));
    const title = url.searchParams.get("title") ?? "Preview";
    if (!isLocalTarget(target)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Preview harness only frames localhost URLs.");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page(target, width, height, title));
  });
  await new Promise<void>((resolve) => server!.listen(port!, "127.0.0.1", resolve));
  return port;
}

export async function wrapUrl(
  target: string,
  opts: { width: number; height: number; title?: string }
): Promise<string> {
  if (!isLocalTarget(target)) throw new Error("Only localhost URLs can be framed.");
  const harborPort = await ensureServer();
  const params = new URLSearchParams({
    url: target,
    w: String(opts.width),
    h: String(opts.height),
    title: opts.title ?? "Preview",
  });
  return `http://127.0.0.1:${harborPort}/?${params}`;
}

export function stop(): void {
  server?.close();
  server = null;
  port = null;
}

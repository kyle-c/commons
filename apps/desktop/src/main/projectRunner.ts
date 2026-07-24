import { spawn, type ChildProcess } from "child_process";
import net from "net";
import http from "http";
import type { DevServerStatus } from "@commons/shared";
import { inspectRepo, readCommonsConfig } from "./routeDiscovery";

interface RunningServer {
  child: ChildProcess;
  status: DevServerStatus;
}

type StatusListener = (repoPath: string, status: DevServerStatus) => void;

const servers = new Map<string, RunningServer>();
const listeners = new Set<StatusListener>();

export function onStatusChange(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(repoPath: string, status: DevServerStatus): void {
  const server = servers.get(repoPath);
  if (server) server.status = status;
  for (const listener of listeners) listener(repoPath, status);
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error("No free port found");
}

function pollUntilReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("Dev server did not become ready in time"));
        else setTimeout(attempt, 500);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

export function getStatus(repoPath: string): DevServerStatus {
  return servers.get(repoPath)?.status ?? { state: "stopped" };
}

export async function start(repoPath: string): Promise<DevServerStatus> {
  const existing = servers.get(repoPath);
  if (existing && existing.status.state !== "error" && existing.status.state !== "stopped") {
    return existing.status;
  }

  const inspection = await inspectRepo(repoPath);
  const config = await readCommonsConfig(repoPath);
  if (inspection.framework === "unknown" && !config?.devCommand) {
    const status: DevServerStatus = {
      state: "error",
      message: "Add a commons.json with a devCommand to run this project (Next.js, Expo, and Vite are automatic)",
    };
    setStatus(repoPath, status);
    return status;
  }

  const port = config?.port ?? (await findFreePort(4310));
  const url = `http://localhost:${port}`;

  const execBin = { pnpm: "pnpm", yarn: "yarn", bun: "bunx", npm: "npx" }[inspection.packageManager];
  // commons.json devCommand wins ({port} substituted); otherwise per-framework
  // defaults. expo serves the web build from metro (--web); vite --strictPort
  // keeps the frame URLs honest.
  const devCommand = config?.devCommand?.length
    ? config.devCommand.map((part) => part.replace("{port}", String(port)))
    : inspection.framework === "expo"
      ? ["expo", "start", "--web", "--port", String(port)]
      : inspection.framework === "vite"
        ? ["vite", "--port", String(port), "--strictPort"]
        : ["next", "dev", "-p", String(port)];
  // A full devCommand names its own binary; framework defaults run via the
  // package manager's exec shim.
  const useExec = !config?.devCommand?.length;
  const spawnBin = useExec ? execBin : devCommand[0];
  const spawnArgs = useExec
    ? inspection.packageManager === "pnpm" || inspection.packageManager === "yarn"
      ? ["exec", ...devCommand]
      : devCommand
    : devCommand.slice(1);

  const child = spawn(spawnBin, spawnArgs, {
    cwd: repoPath,
    // CI=1 keeps the Expo CLI non-interactive and stops it opening a browser.
    env: { ...process.env, PORT: String(port), BROWSER: "none", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });
  child.on("exit", (code) => {
    const current = servers.get(repoPath);
    if (current?.child === child && current.status.state !== "stopped") {
      setStatus(
        repoPath,
        code === 0 || code === null
          ? { state: "stopped" }
          : { state: "error", message: `Dev server exited (${code}). ${stderrTail.split("\n").slice(-5).join("\n")}` }
      );
    }
  });

  servers.set(repoPath, { child, status: { state: "starting", port } });
  setStatus(repoPath, { state: "starting", port });

  try {
    await pollUntilReady(url, 90_000);
    const status: DevServerStatus = { state: "ready", port, url };
    setStatus(repoPath, status);
    return status;
  } catch (err) {
    child.kill();
    const status: DevServerStatus = {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    setStatus(repoPath, status);
    return status;
  }
}

export async function stop(repoPath: string): Promise<void> {
  const server = servers.get(repoPath);
  if (!server) return;
  setStatus(repoPath, { state: "stopped" });
  server.child.kill("SIGTERM");
  servers.delete(repoPath);
}

export function stopAll(): void {
  for (const [repoPath, server] of servers) {
    server.child.kill("SIGTERM");
    servers.delete(repoPath);
  }
}

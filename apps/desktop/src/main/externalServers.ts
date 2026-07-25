import { execFile } from "child_process";

/**
 * Detect dev servers Commons did NOT start: anything listening on TCP whose
 * process cwd sits inside one of the given repos (a `pnpm dev` from a
 * terminal, a Claude Code/Codex session, etc.). Read-only — we surface them,
 * we don't kill other tools' processes.
 */

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? "" : stdout)
    );
  });
}

export interface ExternalServer {
  repoPath: string;
  port: number;
  pid: number;
}

export async function detectExternal(repoPaths: string[], ownedPorts: number[]): Promise<ExternalServer[]> {
  if (repoPaths.length === 0 || process.platform !== "darwin") return [];
  const owned = new Set(ownedPorts);
  // All listening TCP sockets: -Fpn emits p<pid> then n<addr> lines.
  const listing = await run("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P", "-Fpn"]);
  const portsByPid = new Map<number, Set<number>>();
  let pid = 0;
  for (const line of listing.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) {
      const port = Number(line.slice(1).split(":").pop());
      if (Number.isFinite(port) && !owned.has(port)) {
        if (!portsByPid.has(pid)) portsByPid.set(pid, new Set());
        portsByPid.get(pid)!.add(port);
      }
    }
  }
  const results: ExternalServer[] = [];
  const pids = [...portsByPid.keys()].slice(0, 50);
  await Promise.all(
    pids.map(async (candidate) => {
      const cwdOut = await run("lsof", ["-a", "-p", String(candidate), "-d", "cwd", "-Fn"]);
      const cwd = cwdOut
        .split("\n")
        .find((l) => l.startsWith("n"))
        ?.slice(1);
      if (!cwd) return;
      const repo = repoPaths.find((r) => cwd === r || cwd.startsWith(r + "/"));
      if (!repo) return;
      for (const port of portsByPid.get(candidate)!) results.push({ repoPath: repo, port, pid: candidate });
    })
  );
  return results.sort((a, b) => a.port - b.port);
}

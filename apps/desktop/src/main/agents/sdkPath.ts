import path from "path";
import fs from "fs";
import { app } from "electron";

/**
 * Where the Agent SDK's bundled `claude` binary actually lives in a packaged
 * build. The SDK resolves it relative to its own module — which is inside
 * app.asar — and Electron's asar rewrite covers execFile but not spawn, so
 * spawning through the archive fails with ENOTDIR. asarUnpack puts the real
 * binary on disk; this hands the SDK that path. Dev builds return undefined
 * (real node_modules, the SDK's own resolution works).
 */
export function claudeExecutablePath(): string | undefined {
  if (!app.isPackaged) return undefined;
  const unpacked = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@anthropic-ai",
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    "claude"
  );
  return fs.existsSync(unpacked) ? unpacked : undefined;
}

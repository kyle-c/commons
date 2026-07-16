import { execFileSync } from "child_process";

/**
 * GUI-launched macOS apps (double-click, Dock, Spotlight) get a bare
 * `/usr/bin:/bin:/usr/sbin:/sbin` PATH — no Homebrew, no nvm, wherever the
 * user's node/npx/pnpm actually live. Same commands work fine from a
 * Terminal-launched `pnpm dev` because that inherits the shell's real PATH.
 * Fetch it once from the user's login shell and merge it in before anything
 * tries to spawn a package-manager command.
 */
export function fixPath(): void {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const output = execFileSync(shell, ["-ilc", "echo -n __COMMONS_PATH__:$PATH"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const match = output.match(/__COMMONS_PATH__:(.+)/s);
    if (!match) return;
    const shellPaths = match[1].trim().split(":").filter(Boolean);
    const current = (process.env.PATH ?? "").split(":").filter(Boolean);
    process.env.PATH = Array.from(new Set([...current, ...shellPaths])).join(":");
  } catch {
    // Best effort — worst case dev servers fail to spawn, same as before this fix.
  }
}

import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme } from "electron";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { DEEP_LINK_PROTOCOL, parseAuthCallback, parseDeepLink } from "@commons/shared";
import type { AgentStartOptions, AnnotationGenerateRequest } from "@commons/shared";
import { inspectRepo } from "./routeDiscovery";
import * as runner from "./projectRunner";
import * as agents from "./agents/sessionManager";
import * as annotator from "./annotator";
import { detectExternal } from "./externalServers";
import * as appMenu from "./appMenu";
import * as previewHarness from "./previewHarness";
import * as gitOps from "./gitOps";
import * as updater from "./updater";
import * as snapshots from "./snapshots";
import { fixPath } from "./fixPath";

// Must run before anything spawns npx/pnpm/yarn/bunx — GUI-launched apps get
// a PATH that's missing wherever those actually live (see fixPath.ts).
fixPath();

// Dev runs otherwise show the npm package name ("@commons/desktop") in the
// About/Hide/Quit items; packaged builds get it from productName.
app.setName("Commons");

// Broken-canvas forensics: GPU/renderer process failures never reach the
// in-app error reporter, so log them to userData for later inspection.
app.on("child-process-gone", (_e, details) => {
  const line = `${new Date().toISOString()} child-process-gone ${JSON.stringify(details)}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "process-crashes.log"), line);
  } catch {
    /* best effort */
  }
});
app.on("render-process-gone", (_e, _wc, details) => {
  const line = `${new Date().toISOString()} render-process-gone ${JSON.stringify(details)}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "process-crashes.log"), line);
  } catch {
    /* best effort */
  }
});

// Packaged builds get the icon from build/icon.icns via electron-builder;
// dev runs would otherwise wear the stock Electron dock icon.
if (!app.isPackaged) {
  app.whenReady().then(() => {
    try {
      app.dock?.setIcon(path.join(__dirname, "../../build/icon.png"));
    } catch {
      // Missing file in an odd checkout — the default icon is fine in dev.
    }
  });
}

// Main-process failures forward to the renderer, which owns error reporting
// (POST /api/error). Handlers keep the app alive — a background failure
// shouldn't take down the canvas someone is presenting from.
process.on("uncaughtException", (err) => {
  console.error("uncaught (main):", err);
  mainWindow?.webContents.send("main-process-error", err.message, err.stack);
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error("unhandled rejection (main):", err);
  mainWindow?.webContents.send("main-process-error", err.message, err.stack);
});

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#1a1b17",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      // The preload only touches contextBridge and ipcRenderer, so it costs
      // nothing to run it sandboxed — and it caps the damage if the renderer
      // is ever compromised.
      sandbox: true,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // The canvas embeds pages we don't control (the user's app, deploy
    // previews). A window.open from any of them lands here, so hand the OS
    // only schemes that mean "a web page" — file:// and custom schemes hand
    // whatever is registered for them a launch.
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Nothing may navigate the top frame off the app. The preload bridge is
  // attached here, and it can start dev servers, clone repos, run git, and
  // start agents with arbitrary paths — remote content must never inherit it.
  // (Subframes are unaffected: nodeIntegrationInSubFrames is off, so iframes
  // never receive the preload at all.)
  const blockOffAppNavigation = (event: { preventDefault: () => void }, url: string) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  };
  mainWindow.webContents.on("will-navigate", blockOffAppNavigation);
  mainWindow.webContents.on("will-redirect", blockOffAppNavigation);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingDeepLink) {
      dispatchDeepLink(pendingDeepLink);
      pendingDeepLink = null;
    }
  });
}

/**
 * Only ever hand the OS a URL that means "open a web page".
 *
 * shell.openExternal defers to whatever the system has registered for a
 * scheme, so file://, and custom schemes registered by other installed apps,
 * turn a link click into a launch. http/https is the whole legitimate need.
 */
function isSafeExternalUrl(target: string): boolean {
  try {
    const protocol = new URL(target).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false; // unparseable is not safe
  }
}

/** The app's own renderer: the dev server in development, the bundled files when packaged. */
function isAppUrl(target: string): boolean {
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev && target.startsWith(dev)) return true;
  try {
    const url = new URL(target);
    if (url.protocol !== "file:") return false;
    const rendererDir = path.join(__dirname, "..", "renderer");
    return path.normalize(decodeURIComponent(url.pathname)).startsWith(rendererDir);
  } catch {
    return false;
  }
}

function dispatchDeepLink(raw: string): void {
  const auth = parseAuthCallback(raw);
  const link = auth ? null : parseDeepLink(raw);
  if (!auth && !link) return;
  if (mainWindow) {
    if (auth) mainWindow.webContents.send("auth-callback", auth);
    else mainWindow.webContents.send("deep-link", link);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // Coming back from the OAuth browser tab: pull the app in front of it.
    app.focus({ steal: true });
  } else {
    pendingDeepLink = raw;
  }
}

// Packaged builds register commons:// via CFBundleURLTypes from electron-builder's
// `protocols` config; dev runs must register the bare Electron binary explicitly.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady() && mainWindow) dispatchDeepLink(url);
  else pendingDeepLink = url;
});

app.whenReady().then(() => {
  appMenu.install(() => mainWindow);
  ipcMain.on("menu-recents", (_e, recents: { id: string; name: string }[]) => {
    if (Array.isArray(recents)) appMenu.setRecents(recents.filter((r) => r?.id && r?.name));
  });
  ipcMain.handle("pick-repo", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a project repo",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return await inspectRepo(result.filePaths[0]);
  });

  ipcMain.handle("inspect-repo", (_e, repoPath: string) => inspectRepo(repoPath));
  ipcMain.handle("start-dev-server", (_e, repoPath: string, name?: string) => runner.start(repoPath, name));
  ipcMain.handle("list-dev-servers", () => runner.list());
  ipcMain.handle("stop-dev-server", (_e, repoPath: string) => runner.stop(repoPath));
  ipcMain.handle("release-dev-server", (_e, repoPath: string) => runner.release(repoPath));
  ipcMain.handle("get-dev-server-status", (_e, repoPath: string) => runner.getStatus(repoPath));
  ipcMain.handle("open-external", (_e, url: string) => {
    if (!isSafeExternalUrl(url)) return;
    return shell.openExternal(url);
  });
  ipcMain.handle(
    "wrap-preview-url",
    (_e, url: string, opts: { width: number; height: number; title?: string }) =>
      previewHarness.wrapUrl(url, opts)
  );

  ipcMain.handle("git-status", (_e, repoPath: string) => gitOps.status(repoPath));
  ipcMain.handle("git-pull", (_e, repoPath: string) => gitOps.pullFastForward(repoPath));
  ipcMain.handle("git-setup-check", (_e, probeRemote?: string) => gitOps.checkSetup(probeRemote));
  ipcMain.handle("git-set-identity", (_e, name: string, email: string) => gitOps.setIdentity(name, email));
  ipcMain.handle("clone-repo", async (_e, gitRemote: string, suggestedName: string) => {
    if (!mainWindow) return null;
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: `Choose where to put ${suggestedName}`,
      buttonLabel: "Clone here",
      properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const pickedDir = picked.filePaths[0];
    // Pointing at a folder that already IS this repo means "link it", not
    // "clone into it" — the natural misread that used to nest a fresh,
    // dependency-less clone inside an existing working copy.
    const norm = (r: string) => r.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
    const existingRemote = await gitOps.originOf(pickedDir);
    if (existingRemote && norm(existingRemote) === norm(gitRemote)) {
      return { repoPath: pickedDir, linkedExisting: true };
    }
    if (await gitOps.insideRepo(pickedDir)) {
      return {
        error: "That folder is inside another git repo — pick a clean spot (like ~/Code) and Commons will clone into it.",
      };
    }
    // An empty picked folder IS the destination (no felix-mobile-app/
    // felix-mobile-app nesting); otherwise clone into a kebab-named child.
    const entries = await fs.promises.readdir(pickedDir).catch(() => null);
    const pickedIsEmpty = entries !== null && entries.filter((e) => !e.startsWith(".")).length === 0;
    const dirName = suggestedName.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_.]/g, "").toLowerCase() || "repo";
    const target = pickedIsEmpty ? pickedDir : path.join(pickedDir, dirName);
    const result = await gitOps.clone(gitRemote, target);
    return result.ok ? { repoPath: result.message } : { error: result.message };
  });

  ipcMain.handle(
    "capture-snapshot",
    async (_e, url: string, opts: { width: number; height: number; waitForDeploy?: boolean }) => {
      if (opts.waitForDeploy && !(await snapshots.waitForDeploy(url))) return null;
      try {
        return await snapshots.capture(url, opts);
      } catch (err) {
        console.warn("snapshot failed:", err);
        return null;
      }
    }
  );

  ipcMain.handle("get-app-version", () => (app.isPackaged ? app.getVersion() : "dev"));
  // Stable per-device id: working-copy paths (repoLinks) are scoped to it so
  // a second laptop never inherits this one's filesystem paths.
  ipcMain.handle("get-machine-id", () => {
    const file = path.join(app.getPath("userData"), "machine-id");
    try {
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing) return existing;
    } catch {
      // first run on this device
    }
    const id = randomUUID();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, id);
    return id;
  });
  ipcMain.handle("get-update-status", () => updater.status());
  ipcMain.handle("install-update", () => updater.installNow());

  ipcMain.handle("agent-start", (_e, options: AgentStartOptions) => agents.start(options));
  ipcMain.handle("agent-prompt", (_e, sessionId: string, prompt: string) => agents.prompt(sessionId, prompt));
  ipcMain.handle("agent-stop", (_e, sessionId: string) => agents.stop(sessionId));
  ipcMain.handle("agent-list", () => agents.list());

  ipcMain.handle("annotate-project", (_e, request: AnnotationGenerateRequest) => annotator.generate(request));

  ipcMain.handle("detect-external-servers", (_e, repoPaths: string[]) =>
    detectExternal(repoPaths, runner.ownedPorts())
  );

  // Preview appearance: what useColorScheme() reports inside embedded frames.
  // The renderer applies the stored preference on launch (default light — the
  // apps being previewed usually design light-first, and Commons's dark
  // chrome shouldn't leak into them).
  ipcMain.handle("set-preview-appearance", (_e, mode: "light" | "dark" | "system") => {
    if (mode === "light" || mode === "dark" || mode === "system") nativeTheme.themeSource = mode;
  });

  // Dock icon follows the app theme. Runtime-only: Finder and the DMG keep
  // the bundled icns; a truly adaptive icon awaits Icon Composer support.
  ipcMain.handle("set-dock-appearance", (_e, mode: "light" | "dark") => {
    if (mode !== "light" && mode !== "dark") return;
    const dir = app.isPackaged ? process.resourcesPath : path.join(__dirname, "../../build");
    try {
      app.dock?.setIcon(path.join(dir, `dock-${mode}.png`));
    } catch {
      // Missing asset — the bundled icon stands.
    }
  });

  runner.onStatusChange((repoPath, status) => {
    mainWindow?.webContents.send("dev-server-status", repoPath, status);
  });

  agents.onEvent((sessionId, event) => {
    mainWindow?.webContents.send("agent-event", sessionId, event);
  });

  annotator.onProgress((repoPath, summary) => {
    mainWindow?.webContents.send("annotator-progress", repoPath, summary);
  });

  updater.start((status) => {
    mainWindow?.webContents.send("update-status", status);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  runner.stopAll();
  agents.stopAll();
  previewHarness.stop();
  app.quit();
});

app.on("before-quit", () => {
  runner.stopAll();
  agents.stopAll();
});

import { app, shell, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import path from "path";
import { DEEP_LINK_PROTOCOL, parseAuthCallback, parseDeepLink } from "@commons/shared";
import type { AgentStartOptions } from "@commons/shared";
import { inspectRepo } from "./routeDiscovery";
import * as runner from "./projectRunner";
import * as agents from "./agents/sessionManager";
import * as previewHarness from "./previewHarness";
import * as gitOps from "./gitOps";
import * as updater from "./updater";
import * as snapshots from "./snapshots";
import { fixPath } from "./fixPath";

// Must run before anything spawns npx/pnpm/yarn/bunx — GUI-launched apps get
// a PATH that's missing wherever those actually live (see fixPath.ts).
fixPath();

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
    backgroundColor: "#101012",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

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

// Default menu binds ⌘+/⌘−/⌘0 to chrome zoom; drop those roles so the
// renderer can use them for canvas zoom instead.
function installAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "fileMenu" },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ])
  );
}

app.whenReady().then(() => {
  installAppMenu();
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
  ipcMain.handle("start-dev-server", (_e, repoPath: string) => runner.start(repoPath));
  ipcMain.handle("stop-dev-server", (_e, repoPath: string) => runner.stop(repoPath));
  ipcMain.handle("get-dev-server-status", (_e, repoPath: string) => runner.getStatus(repoPath));
  ipcMain.handle("open-external", (_e, url: string) => shell.openExternal(url));
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
    const target = path.join(picked.filePaths[0], suggestedName);
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

  ipcMain.handle("get-update-status", () => updater.status());
  ipcMain.handle("install-update", () => updater.installNow());

  ipcMain.handle("agent-start", (_e, options: AgentStartOptions) => agents.start(options));
  ipcMain.handle("agent-prompt", (_e, sessionId: string, prompt: string) => agents.prompt(sessionId, prompt));
  ipcMain.handle("agent-stop", (_e, sessionId: string) => agents.stop(sessionId));
  ipcMain.handle("agent-list", () => agents.list());

  runner.onStatusChange((repoPath, status) => {
    mainWindow?.webContents.send("dev-server-status", repoPath, status);
  });

  agents.onEvent((sessionId, event) => {
    mainWindow?.webContents.send("agent-event", sessionId, event);
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

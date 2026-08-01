import { app, dialog, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { MenuAction } from "@commons/shared";
import * as updater from "./updater";

/**
 * The native menu bar. Keyboard-first convention (CLAUDE.md) extended to the
 * menus: every app command a shortcut can reach has a menu item showing that
 * shortcut, so the menu bar doubles as the canonical shortcut reference.
 *
 * Items whose keys the renderer already handles (canvas zoom) display their
 * accelerator without registering it (registerAccelerator: false) — the
 * renderer keeps owning the keystroke, the menu click sends the same action.
 */

type GetWindow = () => BrowserWindow | null;

let getWindow: GetWindow = () => null;
let recents: { id: string; name: string }[] = [];

function send(action: MenuAction): void {
  const win = getWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  win.webContents.send("menu-action", action);
}

async function checkForUpdates(): Promise<void> {
  const outcome = await updater.checkNow();
  const win = getWindow() ?? undefined;
  if (outcome.result === "ready") {
    const { response } = await dialog.showMessageBox(win!, {
      type: "info",
      message: `Commons ${outcome.version} is ready to install.`,
      detail: "The update was already downloaded in the background.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) updater.installNow();
    return;
  }
  const text =
    outcome.result === "dev"
      ? { message: "Updates only apply to installed builds.", detail: "This is a development run from source." }
      : outcome.result === "downloading"
        ? {
            message: `Commons ${outcome.version} is on its way.`,
            detail: "It's downloading in the background — a restart chip appears in the titlebar when it's ready.",
          }
        : { message: `You're up to date.`, detail: `Commons ${app.getVersion()} is the latest version.` };
  await dialog.showMessageBox(win!, { type: "info", buttons: ["OK"], ...text });
}

function template(): MenuItemConstructorOptions[] {
  const dev = !app.isPackaged;
  return [
    {
      label: "Commons",
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", click: () => void checkForUpdates() },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => send({ type: "settings" }) },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Project…", accelerator: "CmdOrCtrl+N", click: () => send({ type: "new-project" }) },
        {
          label: "Open Recent",
          submenu:
            recents.length > 0
              ? recents.map((r) => ({
                  label: r.name,
                  click: () => send({ type: "open-project", projectId: r.id }),
                }))
              : [{ label: "No Recent Projects", enabled: false }],
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Canvas", accelerator: "CmdOrCtrl+1", click: () => send({ type: "set-view", view: "canvas" }) },
        {
          label: "Prototype",
          accelerator: "CmdOrCtrl+2",
          click: () => send({ type: "set-view", view: "prototype" }),
        },
        {
          label: "Flow",
          accelerator: "CmdOrCtrl+3",
          click: () => send({ type: "set-view", view: "flow" }),
        },
        { type: "separator" },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          registerAccelerator: false,
          click: () => send({ type: "zoom", dir: "in" }),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          registerAccelerator: false,
          click: () => send({ type: "zoom", dir: "out" }),
        },
        {
          label: "Zoom to Fit",
          accelerator: "CmdOrCtrl+0",
          registerAccelerator: false,
          click: () => send({ type: "zoom", dir: "fit" }),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        // Debugging tools stay out of installed builds — a user hitting ⌘R
        // and watching the app blank out reads it as a crash.
        ...(dev
          ? ([
              { type: "separator" },
              { role: "reload" },
              { role: "forceReload" },
              { role: "toggleDevTools" },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        {
          label: "Next Tab",
          accelerator: "Ctrl+Tab",
          registerAccelerator: false,
          click: () => send({ type: "cycle-tab", dir: 1 }),
        },
        {
          label: "Previous Tab",
          accelerator: "Ctrl+Shift+Tab",
          registerAccelerator: false,
          click: () => send({ type: "cycle-tab", dir: -1 }),
        },
        { type: "separator" },
        { role: "front" },
      ],
    },
    {
      role: "help",
      submenu: [
        { label: "Keyboard Shortcuts", click: () => send({ type: "shortcuts" }) },
        { type: "separator" },
        {
          label: "Report an Issue…",
          click: () => void shell.openExternal("https://github.com/kyle-c/commons/issues"),
        },
      ],
    },
  ];
}

function rebuild(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template()));
}

export function install(getWin: GetWindow): void {
  getWindow = getWin;
  rebuild();
  // Dock: the one action people expect there.
  app.dock?.setMenu(
    Menu.buildFromTemplate([{ label: "New Project…", click: () => send({ type: "new-project" }) }])
  );
}

/** Renderer owns the recents list (localStorage); it feeds the menu here. */
export function setRecents(list: { id: string; name: string }[]): void {
  recents = list.slice(0, 6);
  rebuild();
}

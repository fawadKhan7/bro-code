/** BroCode desktop app — Electron main process.
 *
 *  Runs the hub IN-PROCESS (the hub is a Node library, which is why Electron beats Tauri here —
 *  no sidecar binary, no second language). The window loads the hub-served dashboard at localhost,
 *  so the app and the browser share one UI. The preload bridge adds the two native capabilities a
 *  web page can't do: an OS folder picker and OS notifications.
 *
 *  Coexistence: if a hub is already running on the configured port (e.g. a `duo` CLI session),
 *  the app attaches to it instead of starting a second one.
 *  See docs/05-implementation-plan/phase-07-desktop-app.md.
 */
import { app, BrowserWindow, dialog, ipcMain, Notification, Tray, Menu, nativeImage } from "electron";
import { fileURLToPath } from "url";
import * as path from "path";
import { Hub } from "@duo/hub";
import { loadConfig } from "@duo/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let ownedHub: Hub | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let hubUrl = "";

async function probe(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Attach to a running hub, or start one in-process. */
async function ensureHub(): Promise<string> {
  const port = loadConfig()?.port ?? 3131;
  if (await probe(port)) return `http://127.0.0.1:${port}`; // external hub (e.g. CLI) — attach
  ownedHub = new Hub({ port });
  await ownedHub.start();
  return ownedHub.url;
}

function createWindow(url: string): void {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: "BroCode",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  void win.loadURL(url + "/");
  win.on("closed", () => (win = null));
}

function focusWindow(): void {
  if (!win) createWindow(hubUrl);
  else {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

function setupTray(): void {
  // A blank tray icon (a real asset ships with the packaged app).
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("BroCode");
  const menu = Menu.buildFromTemplate([
    { label: "Open BroCode", click: () => focusWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => focusWindow());
}

// ── Native bridge (invoked from the renderer via preload) ──
ipcMain.handle("duo:pick-folder", async () => {
  const res = await dialog.showOpenDialog(win!, {
    title: "Choose a project folder",
    properties: ["openDirectory", "createDirectory"],
  });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
});

ipcMain.on("duo:notify", (_e, payload: { title: string; body: string }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: payload.title, body: payload.body });
  n.on("click", () => focusWindow());
  n.show();
});

app.whenReady().then(async () => {
  hubUrl = await ensureHub();
  createWindow(hubUrl);
  setupTray();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(hubUrl);
  });
});

app.on("window-all-closed", () => {
  // Stay alive in the tray (macOS convention); explicit Quit exits.
  if (process.platform !== "darwin") {
    /* keep running in tray */
  }
});

app.on("before-quit", async () => {
  if (ownedHub) await ownedHub.stop().catch(() => undefined);
});

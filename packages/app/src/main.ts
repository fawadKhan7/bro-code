/** BroCode desktop app — Electron main process.
 *
 *  Runs the hub IN-PROCESS (the hub is a Node library, which is why Electron beats Tauri here —
 *  no sidecar binary, no second language). The window loads the hub-served dashboard at localhost,
 *  so the app and the browser share one UI. The preload bridge adds the two native capabilities a
 *  web page can't do: an OS folder picker and OS notifications.
 *
 *  Two servers are managed here, both in-process and both probe-or-own: the Phase 1 hub
 *  (agent orchestration) and the Phase 2 coordination server (pairing, queues, locks
 *  across two machines). If either is already running on its port — a `duo` CLI session,
 *  a `npm run coord` session — the app attaches instead of starting a second one, and
 *  only stops what it actually started.
 *
 *  Each server also serves its own dashboard, so both windows are just localhost URLs
 *  and there is no bundler or web server to supervise. The coordination server listens
 *  on 0.0.0.0, so a teammate on the LAN opens the same UI in a plain browser — running
 *  this app is what hosts the session for both of you.
 *  See docs/05-implementation-plan/phase-07-desktop-app.md.
 */
import { app, BrowserWindow, dialog, ipcMain, Notification, Tray, Menu, nativeImage } from "electron";
import { fileURLToPath } from "url";
import * as path from "path";
import { Hub } from "@duo/hub";
import { loadConfig } from "@duo/shared";
import { ensureCoordination, remoteCoordinationUrl, type CoordinationHandle } from "./coordination.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let ownedHub: Hub | null = null;
let coordination: CoordinationHandle | null = null;
let win: BrowserWindow | null = null;
let coordWin: BrowserWindow | null = null;
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

/** The Phase 2 view: network roster, pairing, both queues, locks, approvals.
 *  Its own window — it is a different job from the single-machine hub dashboard. */
function openCoordinationWindow(): void {
  if (!coordination?.hasDashboard) {
    dialog.showMessageBox({
      type: "info",
      title: "Coordination dashboard unavailable",
      message: coordination
        ? "The coordination server is running but has no dashboard staged.\nRun `npm run build:coord:dashboard` and restart."
        : "The coordination server could not be started. Check the logs.",
    });
    return;
  }
  if (coordWin) {
    if (coordWin.isMinimized()) coordWin.restore();
    coordWin.focus();
    return;
  }
  coordWin = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "BroCode — coordination",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  void coordWin.loadURL(coordination.url + "/");
  coordWin.on("closed", () => (coordWin = null));
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
    { label: "Open coordination", click: () => openCoordinationWindow() },
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
  coordination = await ensureCoordination().catch((err: unknown) => {
    console.error("coordination server unavailable:", err instanceof Error ? err.message : err);
    return null;
  });

  // Distributed build pointed at a deployed backend: coordination IS the app.
  // Skip the local hub (recipients don't run agents here) and open the deployed
  // coordination dashboard as the main window, so every copy shares one session.
  if (remoteCoordinationUrl()) {
    openCoordinationWindow();
    setupTray();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) openCoordinationWindow();
    });
    return;
  }

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
  // Only ever stop what this process started — an attached server belongs to someone else.
  if (ownedHub) await ownedHub.stop().catch(() => undefined);
  if (coordination?.owned) await coordination.stop().catch(() => undefined);
});

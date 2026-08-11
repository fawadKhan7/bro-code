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
import * as os from "os";
import { Hub } from "@duo/hub";
import { loadConfig } from "@duo/shared";
import { startCoordinationAgent, type CoordinationAgentHandle, type Runner } from "@duo/coord-client";
import { ensureCoordination, remoteCoordinationUrl, type CoordinationHandle } from "./coordination.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let ownedHub: Hub | null = null;
let coordination: CoordinationHandle | null = null;
let agentHandle: CoordinationAgentHandle | null = null;
let win: BrowserWindow | null = null;
let coordWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let hubUrl = "";

/** Who you are in Phase 2. Both your dashboard and your agent must join as the
 *  same id to be paired to each other — default to the OS user, override with env. */
function coordIdentity(): { userId: string; displayName: string; runner: Runner } {
  const raw = process.env.BROCODE_USER ?? os.userInfo().username ?? "me";
  const userId = raw.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "me";
  const runner: Runner = process.env.BROCODE_RUNNER === "cursor" ? "cursor" : "claude";
  return { userId, displayName: userId, runner };
}

/** One click for Phase 2: pick the project folder, launch your real agent into the
 *  deployed coordination server, and open the dashboard joined as the same identity. */
async function startMyAgent(): Promise<void> {
  const url = remoteCoordinationUrl() || coordination?.url;
  if (!url) {
    dialog.showMessageBox({ type: "info", title: "No coordination server", message: "No coordination server is configured." });
    return;
  }
  const picked = await dialog.showOpenDialog({
    title: "Choose the project folder your agent will work in",
    properties: ["openDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return;

  const { userId, displayName, runner } = coordIdentity();
  try {
    if (agentHandle) agentHandle.stop();
    agentHandle = await startCoordinationAgent({
      url,
      userId,
      displayName,
      runner,
      cwd: picked.filePaths[0],
      onLog: (message) => console.log("[coordination-agent]", message),
    });
    openCoordinationWindow(userId, displayName); // dashboard joins as the same id → paired to this agent
    if (Notification.isSupported()) {
      new Notification({ title: "Agent connected", body: `Your ${runner} agent joined coordination as ${userId}.` }).show();
    }
  } catch (err) {
    dialog.showMessageBox({ type: "error", title: "Could not start agent", message: err instanceof Error ? err.message : String(err) });
  }
}

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
function openCoordinationWindow(userId?: string, displayName?: string): void {
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
  // Joining with ?user= auto-pairs the dashboard to the agent launched under the same id.
  const query = userId ? `?user=${encodeURIComponent(userId)}&name=${encodeURIComponent(displayName ?? userId)}` : "/";
  const target = coordination.url + (userId ? "/" + query : "/");
  if (coordWin) {
    if (userId) void coordWin.loadURL(target);
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
  void coordWin.loadURL(target);
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
    { label: "Start my agent (Phase 2)…", click: () => void startMyAgent() },
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
  // Phase 1 — the local hub: your own two agents build on your machine, over MCP.
  hubUrl = await ensureHub();
  // Phase 2 — the coordination layer: with a deployed URL baked in it connects to
  // the shared server (pair with people on other machines); otherwise it runs
  // locally. Non-fatal — Phase 1 is fully usable without it.
  coordination = await ensureCoordination().catch((err: unknown) => {
    console.error("coordination server unavailable:", err instanceof Error ? err.message : err);
    return null;
  });
  // Phase 1 window is primary; the tray's "Open coordination" opens the Phase 2 view.
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
  agentHandle?.stop();
  if (ownedHub) await ownedHub.stop().catch(() => undefined);
  if (coordination?.owned) await coordination.stop().catch(() => undefined);
});

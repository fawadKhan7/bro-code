/** Preload bridge — the only code with both Node and page access. Exposes exactly two native
 *  capabilities to the dashboard: an OS folder picker and OS notifications. The dashboard feature-
 *  detects `window.duoNative` and falls back to the /api/fs/list browser + in-page cards when it's
 *  absent (plain browser), so one UI serves both.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("duoNative", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("duo:pick-folder"),
  notify: (title: string, body: string): void => ipcRenderer.send("duo:notify", { title, body }),
});

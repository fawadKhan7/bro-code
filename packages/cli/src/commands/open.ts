/** `duo` (no args) / `duo open` — ensure the hub is running and open the dashboard in a browser.
 *  The GUI entry point: with hub-owned sessions (phase 6), the dashboard can set up and run
 *  everything, so this is all a non-terminal user needs to type.
 */
import { spawn } from "child_process";
import { loadConfig } from "@duo/shared";
import { ensureHub } from "../hubProcess.js";

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* ignore — we still print the URL */
  }
}

export async function cmdOpen(): Promise<void> {
  const config = loadConfig();
  const port = config?.port ?? 3131;
  const hub = await ensureHub(port);
  const url = hub.url + "/";
  console.log(`BroCode dashboard: ${url}`);
  if (!config) console.log("  (no config yet — set up your agents in the dashboard, or run `duo init`)");
  openBrowser(url);
}

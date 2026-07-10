/** `duo doctor` — environment diagnosis: config, runner binaries, hub health. Each finding
 *  pairs with its fix. (Multi-runner probes deepen in phase 3.)
 */
import { getAdapter, hasAdapter } from "@duo/adapters";
import { loadConfig } from "@duo/shared";
import { hubReachable } from "../hubProcess.js";

function line(ok: boolean, label: string, detail: string): void {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

export async function cmdDoctor(): Promise<void> {
  console.log("duo doctor\n");

  const config = loadConfig();
  line(!!config, "config", config ? "~/.duo/config.json found" : "run `duo init`");

  if (config) {
    const runners = new Set(config.agents.map((a) => a.runner));
    for (const runner of runners) {
      if (!hasAdapter(runner)) {
        line(false, `runner ${runner}`, "no adapter yet (later phase)");
        continue;
      }
      const result = await getAdapter(runner).detect();
      line(result.ok, `runner ${runner}`, result.ok ? (result.version ?? "installed") : (result.reason ?? "not usable"));
    }

    const up = await hubReachable(config.port);
    line(up, `hub :${config.port}`, up ? "reachable" : "not running (start a session to launch it)");
  }

  console.log("");
}

/** `duo doctor` — environment diagnosis: config, runner binaries, hub health, and (for cursor
 *  runners) live MCP attachment probes. Each finding pairs with its fix.
 */
import { getAdapter, hasAdapter, probeCursorMcp, type CursorMcpStatus } from "@duo/adapters";
import { loadConfig } from "@duo/shared";
import { TOOL_PREFIX } from "../kickoffAssembly.js";
import { hubReachable } from "../hubProcess.js";

function line(ok: boolean | "warn", label: string, detail: string): void {
  const mark = ok === true ? "✓" : ok === "warn" ? "!" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

const MCP_PROBE: Record<CursorMcpStatus, { ok: boolean | "warn"; detail: string }> = {
  ready: { ok: true, detail: "duo MCP ready" },
  "needs-approval": {
    ok: "warn",
    detail: `duo MCP needs approval — run \`cursor-agent mcp enable ${TOOL_PREFIX}\` in that workspace (duo start does this automatically)`,
  },
  "connection-failed": { ok: false, detail: "duo MCP connection failed — is the hub running on the configured port?" },
  absent: { ok: "warn", detail: "duo not in this workspace's .cursor/mcp.json yet (written by duo start)" },
  "no-cli": { ok: false, detail: "cursor-agent not runnable in this workspace" },
};

export async function cmdDoctor(): Promise<void> {
  console.log("duo doctor\n");

  const config = loadConfig();
  line(!!config, "config", config ? "~/.duo/config.json found" : "run `duo init`");
  if (!config) return void console.log("");

  const runners = new Set(config.agents.map((a) => a.runner));
  for (const runner of runners) {
    if (!hasAdapter(runner)) {
      line(false, `runner ${runner}`, "no adapter");
      continue;
    }
    const result = await getAdapter(runner).detect();
    line(result.ok, `runner ${runner}`, result.ok ? (result.version ?? "installed") : (result.reason ?? "not usable"));
  }

  const up = await hubReachable(config.port);
  line(up, `hub :${config.port}`, up ? "reachable" : "not running (start a session to launch it)");

  // Per-workspace MCP attachment probe for cursor runners (the print-mode approval quirk).
  for (const agent of config.agents) {
    if (agent.runner !== "cursor-cli" && agent.runner !== "cursor-ide") continue;
    const status = probeCursorMcp(agent.workspace, TOOL_PREFIX);
    const { ok, detail } = MCP_PROBE[status];
    line(ok, `mcp attach ${agent.id} (${agent.workspace})`, detail);
  }

  console.log("");
}

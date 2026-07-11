/** Cursor CLI adapter — fully automatic via `cursor-agent -p`.
 *
 *  Spike findings (src/cursor-spike-notes.md), which drive the decisions here:
 *  - Streamable HTTP attaches fine; we configure the same /mcp URL as Claude Code.
 *  - A freshly-written server is "not loaded (needs approval)". Fix, applied twice:
 *      configure() runs `cursor-agent mcp enable <name>`, and launch() passes --approve-mcps.
 *  - The kickoff for this runner uses the POLLING approval variant (get_plan_status), not held
 *    calls — chosen because cursor-agent print mode has reported held-call timeouts. The prompt
 *    variant is selected in the CLI's kickoffAssembly (approvalStyleFor: cursor-cli → polling).
 *  - Registration deadline (enforced by the CLI's session runner) is the startup self-check:
 *    if MCP didn't attach, the agent never calls register_agent → loud failure naming the
 *    cursor-ide fallback.
 */
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import type { AgentAdapter, AgentHandle, DetectResult, LaunchContext } from "./types.js";
import { detectBinary, makeLineReader, mergeMcpConfig, summarizeCursorStreamLine } from "./common.js";

function cursorBin(): string {
  return process.env.DUO_CURSOR_BIN ?? "cursor-agent";
}

function mcpEntry(hubUrl: string): Record<string, unknown> {
  // Streamable HTTP — confirmed working in the spike. Cursor uses a bare `url` key.
  return { url: `${hubUrl}/mcp` };
}

class CursorProcessHandle implements AgentHandle {
  readonly kind = "process" as const;
  readonly events = new EventEmitter();
  private _exited = false;

  constructor(readonly agentId: string, private child: ChildProcess) {
    const onOut = makeLineReader((line) => {
      const summary = summarizeCursorStreamLine(line);
      if (summary) this.events.emit("output", summary);
    });
    child.stdout?.on("data", onOut);
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.events.emit("output", `[stderr] ${text.slice(0, 200)}`);
    });
    child.on("error", (err) => this.events.emit("error", err));
    child.on("exit", (code) => {
      this._exited = true;
      this.events.emit("exit", { code });
    });
  }

  get exited(): boolean {
    return this._exited;
  }

  async stop(): Promise<void> {
    if (this._exited) return;
    this.child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (!this._exited) this.child.kill("SIGKILL");
  }
}

export class CursorCliAdapter implements AgentAdapter {
  readonly runner = "cursor-cli" as const;

  async detect(): Promise<DetectResult> {
    const bin = cursorBin();
    const res = detectBinary(bin, ["--version"]);
    if (!res.ok) {
      return {
        ok: false,
        reason: `Cursor CLI ("${bin}") not found on PATH. Install cursor-agent (https://cursor.com/docs/cli) or set DUO_CURSOR_BIN. Alternatively use the cursor-ide runner (manual paste).`,
      };
    }
    return { ok: true, version: res.version };
  }

  async configure(ctx: LaunchContext): Promise<void> {
    const file = path.join(ctx.agent.workspace, ".cursor", "mcp.json");
    mergeMcpConfig(file, ctx.toolPrefix, mcpEntry(ctx.hubUrl));
    // Pre-approve the server so it isn't stuck at "needs approval" (the print-mode quirk).
    try {
      spawnSync(cursorBin(), ["mcp", "enable", ctx.toolPrefix], {
        cwd: ctx.agent.workspace,
        timeout: 15_000,
        stdio: "ignore",
      });
    } catch {
      /* best-effort; --approve-mcps at launch is the backup */
    }
  }

  async launch(ctx: LaunchContext): Promise<AgentHandle> {
    const args = [
      "-p",
      ctx.kickoffPrompt,
      "--output-format",
      "stream-json",
      "--force",
      "--approve-mcps",
      "--trust",
    ];
    const child = spawn(cursorBin(), args, {
      cwd: ctx.agent.workspace,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    return new CursorProcessHandle(ctx.agent.id, child);
  }
}

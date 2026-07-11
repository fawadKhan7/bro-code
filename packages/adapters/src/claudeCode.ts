/** Claude Code adapter — the reference implementation.
 *
 *  Known quirks / decisions (docs/04-strategies-and-design-principles/adapter-isolation.md rule 4):
 *  - Headless `claude -p` will stall on permission prompts unless a permission mode is set.
 *    We pass --permission-mode (default acceptEdits) from config.
 *  - CRITICAL (found in the first real cursor↔claude run): --permission-mode acceptEdits allows
 *    file edits but does NOT auto-grant MCP tool calls — the agent reports "the duo tools aren't
 *    being granted permission" and never registers. Fix: pass --allowedTools "mcp__<prefix>" to
 *    explicitly allow every tool from our MCP server. Server-level entry covers all 16 tools.
 *  - Project-scoped .mcp.json in the workspace is auto-discovered by Claude Code; we also pass
 *    --mcp-config explicitly so discovery never depends on cwd trust prompts.
 *  - stream-json output is parsed into hub log lines; a premature process exit is surfaced as an
 *    "exit" event so the CLI can reopen claimed board items and offer `duo resume`.
 */
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import type { AgentAdapter, AgentHandle, DetectResult, LaunchContext } from "./types.js";
import { detectBinary, makeLineReader, mergeMcpConfig, summarizeClaudeStreamLine } from "./common.js";

/** Read at call time so DUO_CLAUDE_BIN can point at a test/alternate binary. */
function claudeBin(): string {
  return process.env.DUO_CLAUDE_BIN ?? "claude";
}

function mcpEntry(hubUrl: string): Record<string, unknown> {
  return { type: "http", url: `${hubUrl}/mcp` };
}

class ClaudeProcessHandle implements AgentHandle {
  readonly kind = "process" as const;
  readonly events = new EventEmitter();
  private _exited = false;

  constructor(readonly agentId: string, private child: ChildProcess) {
    const onOut = makeLineReader((line) => {
      const summary = summarizeClaudeStreamLine(line);
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

/** Pure arg builder — exported for unit testing (pins the --allowedTools MCP fix). */
export function buildClaudeArgs(ctx: LaunchContext, permissionMode: string): string[] {
  return [
    "-p",
    ctx.kickoffPrompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    permissionMode,
    // Explicitly allow every tool from our MCP server (acceptEdits alone does not grant MCP).
    "--allowedTools",
    `mcp__${ctx.toolPrefix}`,
    "--mcp-config",
    path.join(ctx.agent.workspace, ".mcp.json"),
  ];
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly runner = "claude-code" as const;

  async detect(): Promise<DetectResult> {
    const bin = claudeBin();
    const res = detectBinary(bin, ["--version"]);
    if (!res.ok) {
      return {
        ok: false,
        reason: `Claude Code CLI ("${bin}") not found on PATH. Install it (https://claude.com/claude-code) or set DUO_CLAUDE_BIN.`,
      };
    }
    return { ok: true, version: res.version };
  }

  async configure(ctx: LaunchContext): Promise<void> {
    const file = path.join(ctx.agent.workspace, ".mcp.json");
    mergeMcpConfig(file, ctx.toolPrefix, mcpEntry(ctx.hubUrl));
  }

  async launch(ctx: LaunchContext): Promise<AgentHandle> {
    const permissionMode = String(ctx.runnerOptions?.claudePermissionMode ?? "acceptEdits");
    const args = buildClaudeArgs(ctx, permissionMode);

    const child = spawn(claudeBin(), args, {
      cwd: ctx.agent.workspace,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    return new ClaudeProcessHandle(ctx.agent.id, child);
  }
}

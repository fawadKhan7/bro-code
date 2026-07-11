/** Cursor IDE adapter — the blockage escape hatch (manual paste).
 *
 *  For users who want the full IDE, or when cursor-agent print mode misbehaves. There is no child
 *  process: we write .cursor/mcp.json (+ pre-approve), copy the kickoff to the clipboard, and
 *  print instructions. The returned handle is kind:"manual" and resolves as "started" — the CLI's
 *  registration gate then waits for the agent's register_agent call, which confirms the human
 *  actually pasted the prompt into Cursor's agent chat.
 */
import { spawnSync } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import type { AgentAdapter, AgentHandle, DetectResult, LaunchContext } from "./types.js";
import { copyToClipboard, mergeMcpConfig } from "./common.js";

class ManualHandle implements AgentHandle {
  readonly kind = "manual" as const;
  readonly events = new EventEmitter();
  readonly exited = false;
  constructor(readonly agentId: string) {}
  async stop(): Promise<void> {
    /* nothing to kill — the human owns the Cursor window */
  }
}

export class CursorIdeAdapter implements AgentAdapter {
  readonly runner = "cursor-ide" as const;

  async detect(): Promise<DetectResult> {
    // Always usable — it only needs a human with Cursor open. Clipboard tooling is checked at
    // launch (with a printed-prompt fallback), so detect never blocks a session.
    return { ok: true, version: "manual" };
  }

  async configure(ctx: LaunchContext): Promise<void> {
    const file = path.join(ctx.agent.workspace, ".cursor", "mcp.json");
    mergeMcpConfig(file, ctx.toolPrefix, { url: `${ctx.hubUrl}/mcp` });
    // Pre-approve if cursor-agent is present so the IDE doesn't prompt on first tool use.
    try {
      spawnSync(process.env.DUO_CURSOR_BIN ?? "cursor-agent", ["mcp", "enable", ctx.toolPrefix], {
        cwd: ctx.agent.workspace,
        timeout: 15_000,
        stdio: "ignore",
      });
    } catch {
      /* the IDE will prompt for approval instead */
    }
  }

  async launch(ctx: LaunchContext): Promise<AgentHandle> {
    const tool = copyToClipboard(ctx.kickoffPrompt);
    const banner = [
      "",
      `  ┌─ Agent ${ctx.agent.id} — manual start (cursor-ide) ─────────────────`,
      `  │ Open this workspace in Cursor:`,
      `  │   ${ctx.agent.workspace}`,
      tool
        ? `  │ The kickoff prompt is on your clipboard (${tool}).`
        : `  │ Could not access the clipboard — copy the prompt printed below.`,
      `  │ In Cursor: open Agent chat (Ctrl/Cmd+L), paste, press Enter.`,
      `  │ Waiting for Agent ${ctx.agent.id} to connect…`,
      `  └────────────────────────────────────────────────────────────`,
      "",
    ].join("\n");
    // The CLI prints handle "output"; also print directly so it's visible before wiring.
    process.stdout.write(banner + "\n");
    if (!tool) {
      process.stdout.write(`----- kickoff for Agent ${ctx.agent.id} -----\n${ctx.kickoffPrompt}\n-----\n`);
    }
    return new ManualHandle(ctx.agent.id);
  }
}

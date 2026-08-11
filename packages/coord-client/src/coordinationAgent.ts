/** Reusable "real agent" driver for the coordination layer (Phase 2).
 *
 *  On each coordinated command it spawns a real coding agent (Claude Code or
 *  Cursor CLI) in a local repo, lets it do the work, and reports real progress on
 *  the bus. Used by the `brocode-agent` CLI and, so it's one click, by the desktop
 *  app. Code is shared between the two people via git; this just drives the agent.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { type ActivityPayload, type CommandPayload } from "./protocol.js";
import { CoordClient } from "./client.js";

export type Runner = "claude" | "cursor";

export interface CoordinationAgentOptions {
  /** The coordination server, e.g. the deployed URL. */
  url: string;
  userId: string;
  displayName?: string;
  runner: Runner;
  /** The local repo the agent works in — its edits land here. */
  cwd: string;
  model?: string;
  networkIdOverride?: string;
  /** Hard cap so a runaway agent can't hold the command lock forever (default 15m). */
  timeoutMs?: number;
  /** Optional sink for human-readable status (the CLI logs; the app shows it in-window). */
  onLog?: (message: string) => void;
}

export interface CoordinationAgentHandle {
  client: CoordClient;
  stop(): void;
}

/** The CLI binary for a runner — overridable so a test/alternate build can stand in. */
function binFor(runner: Runner): string {
  return runner === "cursor"
    ? process.env.DUO_CURSOR_BIN ?? "cursor-agent"
    : process.env.DUO_CLAUDE_BIN ?? "claude";
}

/** Headless "do this one task" invocation, per runner. Both edit files in place. */
function argsFor(runner: Runner, instruction: string, model?: string): string[] {
  if (runner === "cursor") {
    // --force applies edits; --trust skips the workspace-trust prompt that would hang a headless run.
    const a = ["-p", instruction, "--force", "--trust"];
    if (model) a.push("--model", model);
    return a;
  }
  // claude -p is headless; acceptEdits lets it write files without a permission prompt.
  const a = ["-p", instruction, "--permission-mode", "acceptEdits"];
  if (model) a.push("--model", model);
  return a;
}

/** Run the real agent to completion. Resolves with a short tail of its output;
 *  rejects on non-zero exit, spawn error, or timeout. */
function runAgent(options: CoordinationAgentOptions, instruction: string): { done: Promise<string>; child: ChildProcess } {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const child = spawn(binFor(options.runner), argsFor(options.runner, instruction, options.model), {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  const done = new Promise<string>((resolve, reject) => {
    let out = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`${options.runner} timed out after ${Math.round(timeoutMs / 1000)}s`)));
    }, timeoutMs);

    const capture = (chunk: Buffer) => {
      out += chunk.toString();
      if (out.length > 4000) out = out.slice(-4000);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", (err) => finish(() => reject(err)));
    child.on("exit", (code) =>
      finish(() => (code === 0 ? resolve(out.trim().slice(-300)) : reject(new Error(`${options.runner} exited with code ${code}`)))),
    );
  });

  return { done, child };
}

/** Connect a real agent to the coordination server and execute every command it
 *  is dispatched. Returns a handle; call `stop()` to disconnect. */
export async function startCoordinationAgent(options: CoordinationAgentOptions): Promise<CoordinationAgentHandle> {
  const log = options.onLog ?? ((m: string) => console.log(m));
  const client = new CoordClient({
    url: options.url,
    auth: {
      userId: options.userId,
      displayName: options.displayName ?? options.userId,
      role: "agent",
      ...(options.networkIdOverride ? { networkIdOverride: options.networkIdOverride } : {}),
    },
  });

  client.on("error", ({ message }) => log(`! ${message}`));
  client.on("session-established", ({ payload }) => log(`paired — session ${payload.sessionId}`));
  client.on("session-ended", ({ payload }) => log(`session ended (${payload.reason})`));
  client.on("contract", ({ payload }) =>
    log(`peer contract: ${payload.method} ${payload.endpoint} v${payload.version}${payload.breaking ? " BREAKING" : ""}`),
  );

  const report = (a: ActivityPayload): void => void client.reportActivity(a).catch(() => undefined);

  client.onCommand(async (command: CommandPayload, envelope) => {
    const instruction =
      command.scope.length > 0
        ? `${command.intent}\n\nWork only within these files: ${command.scope.join(", ")}.`
        : command.intent;

    log(`> running: ${command.intent}`);
    report({ status: "started", task: command.intent, currentAction: `launching ${options.runner}`, filesTouched: command.scope, commandId: envelope.id });

    const { done, child } = runAgent(options, instruction);
    const beat = setInterval(
      () => report({ status: "progress", task: command.intent, currentAction: `${options.runner} working…`, filesTouched: command.scope, commandId: envelope.id }),
      3000,
    );

    try {
      const tail = await done;
      clearInterval(beat);
      report({ status: "completed", task: command.intent, currentAction: tail || "done", filesTouched: command.scope, commandId: envelope.id });
      log(`< done: ${command.intent}`);
    } catch (err) {
      clearInterval(beat);
      const message = err instanceof Error ? err.message : String(err);
      report({ status: "failed", task: command.intent, currentAction: message, filesTouched: command.scope, commandId: envelope.id });
      log(`< failed: ${command.intent} — ${message}`);
    } finally {
      if (!child.killed) child.kill("SIGTERM");
    }
  });

  await client.connect();
  log(`connected to ${options.url} as ${options.userId} — real ${options.runner} agent in ${options.cwd}`);

  return { client, stop: () => client.disconnect() };
}

#!/usr/bin/env node
/** Real agent adapter for the coordination layer (Phase 2).
 *
 *  This is the piece that makes two people's real agents collaborate across
 *  machines. It connects to the coordination server exactly like {@link demoAgent},
 *  but where the demo one sleeps, this one SPAWNS A REAL CODING AGENT
 *  (Claude Code or Cursor CLI) in a local repo and lets it do the work — then
 *  reports the real progress on the bus so the peer and both dashboards see it.
 *
 *  Each person runs one of these against their own checkout of the same repo;
 *  the coordinator serializes commands, holds the file locks, and routes
 *  contracts/approvals between the two agents. Code itself is shared via git.
 *
 *  Example (two machines, same repo cloned on each):
 *    brocode-agent --url https://brocode-ul5rdh8r.b4a.run \
 *        --user fawad --runner claude --cwd ~/projects/app
 *    brocode-agent --url https://brocode-ul5rdh8r.b4a.run \
 *        --user friend --runner cursor --cwd ~/projects/app
 *
 *  Commands are issued by the owner (dashboard, or `demoAgent --role human
 *  --command "..."`); this process only executes them.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { DEFAULT_SERVER_PORT, type ActivityPayload, type CommandPayload } from "./protocol.js";
import { CoordClient } from "./client.js";

type Runner = "claude" | "cursor";

interface Options {
  url: string;
  userId: string;
  displayName: string;
  runner: Runner;
  /** The local repo the agent works in — its edits land here. */
  cwd: string;
  model?: string;
  networkIdOverride?: string;
  /** Hard cap so a runaway agent can't hold the command lock forever. */
  timeoutMs: number;
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, "true");
    }
  }

  const userId = flags.get("user") ?? process.env.COORD_USER ?? "agent";
  const runner = (flags.get("runner") ?? process.env.COORD_RUNNER ?? "claude") === "cursor" ? "cursor" : "claude";
  return {
    url: flags.get("url") ?? process.env.COORD_URL ?? `http://localhost:${DEFAULT_SERVER_PORT}`,
    userId,
    displayName: flags.get("name") ?? userId,
    runner,
    cwd: flags.get("cwd") ?? process.env.COORD_CWD ?? process.cwd(),
    model: flags.get("model") ?? process.env.COORD_MODEL,
    networkIdOverride: flags.get("network"),
    timeoutMs: Number(flags.get("timeout-ms") ?? 15 * 60_000),
  };
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
    // cursor-agent print/headless mode; --force applies edits, --trust skips the
    // workspace-trust prompt that would otherwise hang a headless run.
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
function runAgent(options: Options, instruction: string): { done: Promise<string>; child: ChildProcess } {
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
      finish(() => reject(new Error(`${options.runner} timed out after ${Math.round(options.timeoutMs / 1000)}s`)));
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.length > 4000) out = out.slice(-4000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.trim()) out += text;
      if (out.length > 4000) out = out.slice(-4000);
    });
    child.on("error", (err) => finish(() => reject(err)));
    child.on("exit", (code) =>
      finish(() => (code === 0 ? resolve(out.trim().slice(-300)) : reject(new Error(`${options.runner} exited with code ${code}`)))),
    );
  });

  return { done, child };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new CoordClient({
    url: options.url,
    auth: {
      userId: options.userId,
      displayName: options.displayName,
      role: "agent",
      ...(options.networkIdOverride ? { networkIdOverride: options.networkIdOverride } : {}),
    },
  });

  client.on("error", ({ message }) => console.error(`! ${message}`));
  client.on("session-established", ({ payload }) => console.log(`paired — session ${payload.sessionId}`));
  client.on("session-ended", ({ payload }) => console.log(`session ended (${payload.reason})`));
  client.on("contract", ({ payload }) =>
    console.log(`peer contract: ${payload.method} ${payload.endpoint} v${payload.version}${payload.breaking ? " BREAKING" : ""}`),
  );

  await client.connect();
  console.log(`connected to ${options.url} as ${options.userId} — real ${options.runner} agent in ${options.cwd}`);

  const report = (a: ActivityPayload): void => void client.reportActivity(a).catch(() => undefined);

  client.onCommand(async (command: CommandPayload, envelope) => {
    const instruction =
      command.scope.length > 0
        ? `${command.intent}\n\nWork only within these files: ${command.scope.join(", ")}.`
        : command.intent;

    console.log(`> running: ${command.intent}`);
    report({ status: "started", task: command.intent, currentAction: `launching ${options.runner}`, filesTouched: command.scope, commandId: envelope.id });

    const { done, child } = runAgent(options, instruction);
    // Heartbeat so the peer/dashboards see it's genuinely working, not hung.
    const beat = setInterval(
      () => report({ status: "progress", task: command.intent, currentAction: `${options.runner} working…`, filesTouched: command.scope, commandId: envelope.id }),
      3000,
    );

    try {
      const tail = await done;
      clearInterval(beat);
      report({ status: "completed", task: command.intent, currentAction: tail || "done", filesTouched: command.scope, commandId: envelope.id });
      console.log(`< done: ${command.intent}`);
    } catch (err) {
      clearInterval(beat);
      const message = err instanceof Error ? err.message : String(err);
      report({ status: "failed", task: command.intent, currentAction: message, filesTouched: command.scope, commandId: envelope.id });
      console.error(`< failed: ${command.intent} — ${message}`);
    } finally {
      if (!child.killed) child.kill("SIGTERM");
    }
  });

  const shutdown = (): void => {
    client.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

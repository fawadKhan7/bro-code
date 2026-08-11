#!/usr/bin/env node
/** `brocode-agent` — command-line entry to the real Phase 2 agent.
 *
 *  Thin wrapper over {@link startCoordinationAgent}; the desktop app calls the
 *  same function directly so Phase 2 is one click there. Commands are issued by
 *  the owner (dashboard, or `demoAgent --role human --command "..."`); this
 *  process only executes them, by running a real Claude/Cursor on the local repo.
 *
 *  Example (two machines, same project cloned on each):
 *    brocode-agent --url https://brocode-ul5rdh8r.b4a.run --user fawad --runner claude --cwd ~/projects/app
 *    brocode-agent --url https://brocode-ul5rdh8r.b4a.run --user friend --runner cursor --cwd ~/projects/app
 */
import { DEFAULT_SERVER_PORT } from "./protocol.js";
import { startCoordinationAgent, type Runner } from "./coordinationAgent.js";

function parseArgs(argv: string[]): { flags: Map<string, string> } {
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
  return { flags };
}

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const userId = flags.get("user") ?? process.env.COORD_USER ?? "agent";
  const runner: Runner = (flags.get("runner") ?? process.env.COORD_RUNNER ?? "claude") === "cursor" ? "cursor" : "claude";

  const handle = await startCoordinationAgent({
    url: flags.get("url") ?? process.env.COORD_URL ?? `http://localhost:${DEFAULT_SERVER_PORT}`,
    userId,
    displayName: flags.get("name") ?? userId,
    runner,
    cwd: flags.get("cwd") ?? process.env.COORD_CWD ?? process.cwd(),
    model: flags.get("model") ?? process.env.COORD_MODEL,
    networkIdOverride: flags.get("network"),
    ...(flags.get("timeout-ms") ? { timeoutMs: Number(flags.get("timeout-ms")) } : {}),
  });

  const shutdown = (): void => {
    handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

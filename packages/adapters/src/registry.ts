/** Runner → adapter lookup. Adding a runner is one import + one map entry (plus the adapter file). */
import type { Runner } from "@duo/shared";
import type { AgentAdapter } from "./types.js";
import { ClaudeCodeAdapter } from "./claudeCode.js";
import { CursorCliAdapter } from "./cursorCli.js";
import { CursorIdeAdapter } from "./cursorIde.js";

const adapters = new Map<Runner, AgentAdapter>([
  ["claude-code", new ClaudeCodeAdapter()],
  ["cursor-cli", new CursorCliAdapter()],
  ["cursor-ide", new CursorIdeAdapter()],
]);

export function getAdapter(runner: Runner): AgentAdapter {
  const adapter = adapters.get(runner);
  if (!adapter) {
    throw new Error(
      `No adapter for runner "${runner}". Available: ${[...adapters.keys()].join(", ")}.`
    );
  }
  return adapter;
}

export function knownRunners(): Runner[] {
  return [...adapters.keys()];
}

export function hasAdapter(runner: Runner): boolean {
  return adapters.has(runner);
}

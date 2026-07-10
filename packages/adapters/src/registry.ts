/** Runner → adapter lookup. Adding a runner is one import + one map entry (plus the adapter file). */
import type { Runner } from "@duo/shared";
import type { AgentAdapter } from "./types.js";
import { ClaudeCodeAdapter } from "./claudeCode.js";

const adapters = new Map<Runner, AgentAdapter>([["claude-code", new ClaudeCodeAdapter()]]);

export function getAdapter(runner: Runner): AgentAdapter {
  const adapter = adapters.get(runner);
  if (!adapter) {
    throw new Error(
      `No adapter for runner "${runner}". Available: ${[...adapters.keys()].join(", ")}. ` +
        `(cursor-cli and cursor-ide arrive in phase 3.)`
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

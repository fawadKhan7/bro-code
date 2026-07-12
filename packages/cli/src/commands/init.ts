/** `duo init` — interactive config, written to ~/.duo/config.json. */
import * as path from "path";
import * as readline from "readline/promises";
import { stdin, stdout } from "process";
import {
  defaultConfig,
  isPresetId,
  saveConfig,
  type AgentConfig,
  type ClaudePermissionMode,
  type DuoConfig,
  type Mode,
  type Runner,
} from "@duo/shared";
import { hasAdapter, knownRunners } from "@duo/adapters";

async function ask(rl: readline.Interface, question: string, fallback: string): Promise<string> {
  const answer = (await rl.question(`${question} ${fallback ? `[${fallback}] ` : ""}`)).trim();
  return answer || fallback;
}

export async function cmdInit(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    console.log("Configuring a BroCode session (two agents).\n");
    const runnersHint = knownRunners().join(", ");

    const agents: AgentConfig[] = [];
    for (const id of ["A", "B"]) {
      console.log(`— Agent ${id} —`);
      const workspace = path.resolve(await ask(rl, `  Workspace path for Agent ${id}:`, process.cwd()));
      const runner = (await ask(rl, `  Runner (${runnersHint}):`, "claude-code")) as Runner;
      if (!hasAdapter(runner)) {
        console.log(`  ! "${runner}" has no adapter yet (arrives in a later phase). Using claude-code.`);
      }
      const role = await ask(rl, `  Role for Agent ${id}:`, id === "A" ? "Frontend" : "Backend");
      agents.push({ id, workspace, runner: hasAdapter(runner) ? runner : "claude-code", role });
      console.log("");
    }

    const preset = await ask(rl, "Preset:", "frontend-backend");
    const mode = (await ask(rl, "Mode (auto-run | checkpoint):", "auto-run")) as Mode;
    const permission = (await ask(
      rl,
      "Claude permission mode (acceptEdits | bypassPermissions | default):",
      "acceptEdits"
    )) as ClaudePermissionMode;
    const port = Number(await ask(rl, "Hub port:", "3131"));

    const config: DuoConfig = {
      ...defaultConfig(),
      agents,
      preset: isPresetId(preset) ? preset : "frontend-backend",
      mode: mode === "checkpoint" ? "checkpoint" : "auto-run",
      claudePermissionMode: permission,
      port: Number.isFinite(port) ? port : 3131,
    };
    if (config.preset === "custom") {
      config.customRoleA = agents[0].role;
      config.customRoleB = agents[1].role;
    }

    saveConfig(config);
    console.log("\n✓ Saved configuration to ~/.duo/config.json");
    console.log(`  Agent A: ${agents[0].role} (${agents[0].runner}) → ${agents[0].workspace}`);
    console.log(`  Agent B: ${agents[1].role} (${agents[1].runner}) → ${agents[1].workspace}`);
    console.log(`\nNext: duo start "<your goal>"`);
  } finally {
    rl.close();
  }
}

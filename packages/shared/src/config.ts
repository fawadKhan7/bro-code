/** User config — written by `duo init`, read by `duo start`. Persisted at ~/.duo/config.json. */
import * as fs from "fs";
import * as path from "path";
import { configPath, duoHome } from "./paths.js";
import type { AgentConfig, Mode } from "./types.js";
import type { PresetId } from "./presets.js";

/** How Claude Code handles tool-permission prompts in headless runs. */
export type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export interface DuoConfig {
  agents: AgentConfig[];
  preset: PresetId;
  mode: Mode;
  port: number;
  /** Passed to `claude --permission-mode`. Headless runs need edits accepted to make progress. */
  claudePermissionMode: ClaudePermissionMode;
  /** Custom role names when preset === "custom". */
  customRoleA?: string;
  customRoleB?: string;
}

export function defaultConfig(): DuoConfig {
  return {
    agents: [],
    preset: "frontend-backend",
    mode: "auto-run",
    port: 3131,
    claudePermissionMode: "acceptEdits",
  };
}

export function loadConfig(): DuoConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return { ...defaultConfig(), ...(JSON.parse(raw) as DuoConfig) };
  } catch {
    return null;
  }
}

export function saveConfig(config: DuoConfig): void {
  fs.mkdirSync(duoHome(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
}

export function configExists(): boolean {
  return fs.existsSync(configPath());
}

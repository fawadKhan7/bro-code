import * as fs from "fs";
import { configPath, conductorHome } from "./paths";
import type { ConductorConfig } from "./types";
import { isPresetId } from "./presets";

export function loadConfig(): ConductorConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as ConductorConfig;
    if (!parsed.pathA || !parsed.pathB || !isPresetId(parsed.preset)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveConfig(config: ConductorConfig): void {
  fs.mkdirSync(conductorHome(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
}

import * as path from "path";
import { saveConfig, PRESETS, isPresetId, type ConductorConfig, type PresetId } from "@conductor/shared";
import { ask } from "../prompt";

export async function cmdInit(): Promise<void> {
  console.log("Conductor init — register two project folders (no API keys).\n");

  const pathA = path.resolve(await ask("Agent A workspace path: "));
  const pathB = path.resolve(await ask("Agent B workspace path: "));

  console.log("\nPresets:");
  for (const p of Object.values(PRESETS)) {
    console.log(`  ${p.id} — ${p.label}`);
  }
  console.log("  custom — define roles in config or per-start --agent-a/--agent-b\n");

  const presetRaw = (await ask("Default preset [frontend-backend]: ")) || "frontend-backend";
  const preset: PresetId = isPresetId(presetRaw) ? presetRaw : "frontend-backend";

  const config: ConductorConfig = { pathA, pathB, preset };
  if (preset === "custom") {
    config.customRoleA = (await ask("Custom role name for A: ")) || "Agent A";
    config.customRoleB = (await ask("Custom role name for B: ")) || "Agent B";
  }

  saveConfig(config);
  console.log("\nSaved ~/.conductor/config.json");
  console.log("Next: conductor start \"<your goal>\"");
}

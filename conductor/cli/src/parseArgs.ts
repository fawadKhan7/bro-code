import type { PresetId } from "@conductor/shared";
import { isPresetId } from "@conductor/shared";

export interface StartArgs {
  goal: string | null;
  preset?: PresetId;
  briefA?: string;
  briefB?: string;
}

export function parseStartArgs(argv: string[]): StartArgs {
  let goal: string | null = null;
  let preset: PresetId | undefined;
  let briefA: string | undefined;
  let briefB: string | undefined;

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--preset" && argv[i + 1]) {
      const p = argv[++i];
      if (isPresetId(p)) preset = p;
      continue;
    }
    if (a === "--agent-a" && argv[i + 1]) {
      briefA = argv[++i];
      continue;
    }
    if (a === "--agent-b" && argv[i + 1]) {
      briefB = argv[++i];
      continue;
    }
    if (!a.startsWith("-")) positional.push(a);
  }

  if (positional.length > 0) {
    goal = positional.join(" ");
  }

  return { goal, preset, briefA, briefB };
}

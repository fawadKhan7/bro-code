import * as path from "path";
import {
  buildBriefs,
  injectRule,
  loadConfig,
  loadSession,
  removeInjectedRule,
  saveSession,
  scanProjectMap,
  type ConductorSession,
  type PresetId,
} from "@conductor/shared";
import { parseStartArgs } from "../parseArgs";
import { defaultMcpServerPath, mcpConfigSnippet } from "../mcpSnippet";

export async function cmdStart(argv: string[]): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error("Run conductor init first.");
    process.exit(1);
  }

  const args = parseStartArgs(argv);
  if (!args.goal && !(args.briefA && args.briefB)) {
    console.error('Usage: conductor start "<goal>" [--preset name]');
    console.error("   or: conductor start --agent-a \"...\" --agent-b \"...\"");
    process.exit(1);
  }

  const goal = args.goal ?? "See per-agent briefs.";
  const preset: PresetId = args.preset ?? config.preset;
  const { briefA, briefB } = buildBriefs(goal, preset, {
    briefA: args.briefA,
    briefB: args.briefB,
    customRoleA: config.customRoleA,
    customRoleB: config.customRoleB,
  });

  const existing = loadSession();
  if (existing.active) {
    removeInjectedRule(existing.pathA);
    removeInjectedRule(existing.pathB);
  }

  const mapA = scanProjectMap(config.pathA);
  const mapB = scanProjectMap(config.pathB);

  const injectedRuleA = injectRule(config.pathA, "agent-a", briefA, mapA);
  const injectedRuleB = injectRule(config.pathB, "agent-b", briefB, mapB);

  const session: ConductorSession = {
    active: true,
    goal,
    preset,
    pathA: config.pathA,
    pathB: config.pathB,
    briefA,
    briefB,
    injectedRuleA,
    injectedRuleB,
    contractVersion: 0,
    updates: [],
    checkpointA: null,
    checkpointB: null,
    checkpointPhase: "idle",
    lastFeedback: null,
    resumeBriefVersion: 0,
    resumeBrief: null,
    startedAt: new Date().toISOString(),
  };

  saveSession(session);

  const mcpPath = defaultMcpServerPath();
  console.log("Conductor session started.\n");
  console.log(`Goal: ${goal}`);
  console.log(`Preset: ${preset}`);
  console.log(`Agent A: ${config.pathA}`);
  console.log(`Agent B: ${config.pathB}`);
  console.log(`\nInjected rules:\n  ${injectedRuleA}\n  ${injectedRuleB}`);
  console.log("\nAdd to Cursor MCP settings (~/.cursor/mcp.json), then restart Cursor:\n");
  console.log(mcpConfigSnippet(mcpPath));
  console.log("\nOpen each workspace in Cursor and start background agents on the shared goal.");
  console.log("Monitor: conductor status  |  Checkpoint: conductor feedback [message]");
}

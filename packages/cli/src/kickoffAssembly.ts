/** Assemble per-agent kickoff prompts from config: presets + project scan + prompt builder.
 *  Runner determines approval style (held vs polling) — a per-adapter concern surfaced here.
 */
import {
  buildBriefs,
  buildKickoff,
  buildResumeKickoff,
  scanProjectMap,
  type AgentConfig,
  type DuoConfig,
  type KickoffContext,
  type ApprovalStyle,
} from "@duo/shared";

export const TOOL_PREFIX = "duo";

/** cursor-cli may need polling instead of held calls (phase 3); claude-code uses held. */
function approvalStyleFor(agent: AgentConfig): ApprovalStyle {
  return agent.runner === "cursor-cli" ? "polling" : "held";
}

/** Brief for one agent. v1: agent[0] → briefA, agent[1] → briefB. */
function briefFor(config: DuoConfig, agent: AgentConfig, goal: string): string {
  const briefs = buildBriefs(goal, config.preset, {
    customRoleA: config.customRoleA,
    customRoleB: config.customRoleB,
  });
  const index = config.agents.findIndex((a) => a.id === agent.id);
  if (index === 0) return briefs.briefA;
  if (index === 1) return briefs.briefB;
  // Fallback for >2 agents: role line only.
  return `Role: ${agent.role}\n\nShared goal: ${goal}\n\nThis is a starting bias, not a boundary.`;
}

export interface AssembleOptions {
  goal: string;
  plan: boolean;
}

function contextFor(
  config: DuoConfig,
  agent: AgentConfig,
  opts: AssembleOptions
): KickoffContext {
  return {
    agent,
    peers: config.agents.filter((a) => a.id !== agent.id),
    goal: opts.goal,
    brief: briefFor(config, agent, opts.goal),
    projectMap: scanProjectMap(agent.workspace),
    mode: config.mode,
    plan: opts.plan,
    approvalStyle: approvalStyleFor(agent),
    toolPrefix: TOOL_PREFIX,
  };
}

export function assembleKickoff(config: DuoConfig, agent: AgentConfig, opts: AssembleOptions): string {
  return buildKickoff(contextFor(config, agent, opts));
}

export function assembleResumeKickoff(config: DuoConfig, agent: AgentConfig, goal: string): string {
  return buildResumeKickoff(contextFor(config, agent, { goal, plan: false }));
}

/** For --no-plan: one preset-derived board item per agent. */
export function presetBoard(config: DuoConfig, goal: string): Array<{ title: string; ownerHint: string; paths: string[] }> {
  return config.agents.map((agent) => ({
    title: `${agent.role}: ${goal}`,
    ownerHint: agent.id,
    paths: [],
  }));
}

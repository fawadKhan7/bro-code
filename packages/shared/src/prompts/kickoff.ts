/** Kickoff prompt builder — the single source of truth for what agents are told.
 *  Deterministic (no timestamps/randomness) so it can be golden-file tested.
 *  Adapters DELIVER these prompts (argument or clipboard); they never author them.
 *  See docs/03-core-concepts/agent.md and docs/04-strategies-and-design-principles/planning-strategy.md.
 */
import type { AgentConfig, Mode } from "../types.js";

export type ApprovalStyle = "held" | "polling";

export interface KickoffContext {
  agent: AgentConfig;
  peers: AgentConfig[];
  goal: string;
  /** Role brief from buildBriefs() — role, focus-as-bias. */
  brief: string;
  /** Project map from scanProjectMap() — may be empty (greenfield). */
  projectMap: string;
  mode: Mode;
  /** true = planning phase; false = --no-plan (task already on the board). */
  plan: boolean;
  /** held = await_plan_approval blocks; polling = get_plan_status + backoff. */
  approvalStyle: ApprovalStyle;
  /** MCP server name as configured in the client (mcp.json key). Default "duo". */
  toolPrefix?: string;
}

function heading(text: string): string {
  return `## ${text}`;
}

function bindingBlock(ctx: KickoffContext): string {
  const peerDesc =
    ctx.peers.length === 0
      ? "You are working alone."
      : ctx.peers
          .map((p) => `Agent ${p.id} (${p.role}), working in ${p.workspace}`)
          .join("; ");
  return [
    heading("Your identity"),
    `You are Agent ${ctx.agent.id} in a multi-agent collaboration.`,
    `Your workspace: ${ctx.agent.workspace}`,
    `Work ONLY inside that folder. Never edit files in a peer's workspace.`,
    `Peers working in parallel: ${peerDesc}`,
    `Coordinate exclusively through the "${ctx.toolPrefix ?? "duo"}" MCP tools — never assume a peer's state, always ask the tools.`,
  ].join("\n");
}

function planBlock(ctx: KickoffContext): string {
  const approvalInstruction =
    ctx.approvalStyle === "held"
      ? `3. Call \`await_plan_approval\` and WAIT. If it returns {pending: true, retry: true}, call it again — do not give up and do not start coding. When it returns {approved: true}, continue.`
      : `3. Poll \`get_plan_status\` every few seconds until phase becomes "executing". Do not start coding before then. (Back off between polls — this is not a tight loop.)`;

  return [
    heading("Step 1 — Plan before coding"),
    `Before writing ANY code, explore your workspace enough to propose a work breakdown.`,
    `1. Read the project map below and open only the few files this goal actually touches.`,
    `2. Call \`post_plan\` with structured items (\`{ title, ownerHint, paths }\`), at most 8.`,
    `   - Plan ONLY your own workstream (your role's slice). Do NOT re-plan your peer's half — they plan theirs.`,
    `   - Set \`ownerHint\` to your agent id for your items. For a few genuinely shared/cross-cutting pieces (repo scaffold, shared contract, env files, README) add at most 3 items with ownerHint null — the app assigns those automatically, so don't duplicate them across both of you.`,
    `   - Titles are one line each. No prose, no design essays — interfaces are decided later via contracts.`,
    `   - Also pass \`plan_summary\`: 2-3 plain sentences for the human reviewer. Name the key TECHNOLOGIES you'll use (frameworks, libraries, database) and your approach/order. Write it for a non-engineer deciding whether to approve.`,
    approvalInstruction,
    ``,
    heading("Step 2 — Execute the approved board"),
    `Once approved, the human may have reassigned or added items. Then:`,
    `- Call \`get_board\` (pass since_version on later calls for deltas). Claim an item with \`claim_task\` BEFORE working on it — you may only claim items you own.`,
    `- The moment an interface/shape is DECIDED (API route, schema, data format), call \`post_contract\` so peers can integrate — even before you've implemented it. ${contractHowto}`,
    `- Read peer contracts with \`get_contracts\` when you are ready to integrate — not in a loop.`,
    `- Call \`post_update\` at milestones (include refs to files you changed).`,
    `- Call \`complete_task\` with refs when an item is done.`,
  ].join("\n");
}

const contractHowto =
  "Give a one-sentence plain-language `summary` (what was decided) and structure the content as: What was decided / The interface / Example.";

function noPlanBlock(ctx: KickoffContext): string {
  return [
    heading("Step 1 — Your task is already assigned"),
    `Planning was skipped for this session. Your work item is already on the board.`,
    `- Call \`get_board\`, find the item you own, and \`claim_task\` it before starting.`,
    `- The moment an interface/shape is DECIDED, call \`post_contract\` so peers can integrate. ${contractHowto}`,
    `- Read peer contracts with \`get_contracts\` when ready to integrate.`,
    `- Call \`post_update\` at milestones; \`complete_task\` with refs when done.`,
  ].join("\n");
}

function modeBlock(ctx: KickoffContext): string {
  if (ctx.mode === "checkpoint") {
    const waitHint =
      ctx.approvalStyle === "held"
        ? `then call \`get_checkpoint_status\` with wait: true (retry on {pending: true}).`
        : `then poll \`get_checkpoint_status\` until it is approved or returns feedback.`;
    return [
      heading("Checkpoint mode"),
      `Before any major or irreversible action (destructive migration, deploy, deleting data):`,
      `call \`post_checkpoint\` (summary = what you did, next_step = what you'll do next). Write for a`,
      `non-engineer: also give \`why\` (why you're pausing / what approval means) and \`impact\``,
      `(what happens if they approve) in plain language. Then ${waitHint}`,
      `If you receive feedback, adjust and continue. Do NOT act before you are approved.`,
      ``,
      `If you need to ASK the user something (not propose an action), call \`post_checkpoint\` with`,
      `kind: "question" and your question in \`summary\`. Take NO action until the answer arrives via`,
      `feedback, then act on it.`,
    ].join("\n");
  }
  return [
    heading("Auto-run mode"),
    `Work autonomously to completion without pausing for approval. Use \`post_update\` to keep the human informed.`,
  ].join("\n");
}

function finishBlock(): string {
  return [
    heading("Before you declare yourself done"),
    `Re-read the full board and the original goal. If anything the goal needs is still missing`,
    `(env vars, migrations, docs, tests, deployment), it must be a board item — add it via a`,
    `checkpoint note to the human or finish it yourself. Do not silently drop work.`,
    `The session is only complete when every board item is done or marked out of scope by the human.`,
  ].join("\n");
}

function projectMapBlock(ctx: KickoffContext): string {
  if (!ctx.projectMap.trim()) {
    return [heading("Project map"), `(empty workspace — nothing to orient from yet)`].join("\n");
  }
  return ctx.projectMap.trim();
}

/** Full kickoff prompt for a fresh session. */
export function buildKickoff(ctx: KickoffContext): string {
  const parts = [
    ctx.brief.trim(),
    bindingBlock(ctx),
    projectMapBlock(ctx),
    ctx.plan ? planBlock(ctx) : noPlanBlock(ctx),
    modeBlock(ctx),
    finishBlock(),
    heading("Start now"),
    `First, call \`register_agent\` with agent_id "${ctx.agent.id}" and your workspace path. Then begin.`,
  ];
  return parts.join("\n\n") + "\n";
}

/** Shortened kickoff for resuming a crashed/interrupted agent. */
export function buildResumeKickoff(ctx: KickoffContext): string {
  const parts = [
    `You are resuming as Agent ${ctx.agent.id} (${ctx.agent.role}) in an in-progress collaboration.`,
    `Goal: ${ctx.goal}`,
    bindingBlock(ctx),
    heading("Recover your context first"),
    `1. Call \`register_agent\` (agent_id "${ctx.agent.id}", your workspace path).`,
    `2. Call \`get_resume_brief\` — it gives you your remaining board items, the contracts in force,`,
    `   what peers have completed (with file refs), and the latest human feedback. Do NOT re-explore`,
    `   the whole project; open only the files your remaining items touch.`,
    `3. Re-claim any of your items that were reopened, then continue execution.`,
    modeBlock(ctx),
    finishBlock(),
  ];
  return parts.join("\n\n") + "\n";
}

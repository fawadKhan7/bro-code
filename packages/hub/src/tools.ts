/** The agent-facing MCP tool catalog — transport-agnostic.
 *  Both the streamable-HTTP (SDK) and legacy-SSE transports front these same handlers.
 *  Cheap structured rejections, never hangs (long-polls always time out with retry:true).
 */
import { z } from "zod";
import type { SessionStore } from "./store.js";

/** Default long-poll hold; DUO_LONGPOLL_MS overrides (tests use short values). */
export function longPollMs(): number {
  const v = Number(process.env.DUO_LONGPOLL_MS);
  return Number.isFinite(v) && v > 0 ? v : 120_000;
}

export interface ToolDef {
  name: string;
  description: string;
  /** zod raw shape — the SDK derives JSON schema from this. */
  shape: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

const planItemSchema = z.object({
  title: z.string().max(200).describe("One line, imperative. No prose."),
  ownerHint: z
    .string()
    .nullable()
    .optional()
    .describe("Suggested owner agent id. Omit/null for items that don't clearly belong to you."),
  paths: z.array(z.string()).optional().describe("Files/dirs this item touches, workspace-relative."),
});

export function createToolset(store: SessionStore): ToolDef[] {
  return [
    {
      name: "register_agent",
      description:
        "Announce yourself to the hub. Call this FIRST, immediately after starting. Idempotent.",
      shape: {
        agent_id: z.string().describe("Your agent id from the kickoff prompt (e.g. \"A\")."),
        workspace_path: z.string().describe("Absolute path of your workspace."),
      },
      handler: (a) => store.registerAgent(String(a.agent_id), String(a.workspace_path)),
    },
    {
      name: "get_session_brief",
      description: "Goal, your role/workspace, peers, current phase and mode. Kickoff backup — call if unsure of context.",
      shape: { agent_id: z.string() },
      handler: (a) => store.sessionBrief(String(a.agent_id)),
    },
    {
      name: "post_plan",
      description:
        "PLANNING phase: propose your work breakdown as structured items (≤15). Include EVERYTHING the goal needs — code, env vars, migrations, deployment. Leave unclear items unassigned (no ownerHint). Re-posting replaces your previous proposal.",
      shape: {
        agent_id: z.string(),
        items: z.array(planItemSchema).describe("Task items. Titles + paths only — no essays."),
      },
      handler: (a) => store.postPlan(String(a.agent_id), (a.items ?? []) as never),
    },
    {
      name: "await_plan_approval",
      description:
        "PLANNING phase: block until the human approves the merged plan. If it returns {pending:true, retry:true}, call it again — do not give up, do not start coding.",
      shape: { agent_id: z.string() },
      handler: async () => store.awaitPlanApproval(longPollMs()),
    },
    {
      name: "get_plan_status",
      description: "PLANNING phase: non-blocking plan status (polling fallback for await_plan_approval).",
      shape: { agent_id: z.string() },
      handler: () => store.planStatus(),
    },
    {
      name: "get_board",
      description:
        "Read the task board. Pass since_version (from your last read) to receive only changed items — never re-read the whole board.",
      shape: { since_version: z.number().optional() },
      handler: (a) => store.getBoard(a.since_version === undefined ? undefined : Number(a.since_version)),
    },
    {
      name: "claim_task",
      description: "EXECUTING phase: claim a board item before working on it. You can only claim items you own.",
      shape: { agent_id: z.string(), task_id: z.string() },
      handler: (a) => store.claimTask(String(a.agent_id), String(a.task_id)),
    },
    {
      name: "complete_task",
      description:
        "EXECUTING phase: mark a claimed item done. Pass refs — file paths the other agent should look at.",
      shape: {
        agent_id: z.string(),
        task_id: z.string(),
        refs: z.array(z.string()).optional().describe("File paths, workspace-relative. Not code."),
      },
      handler: (a) => store.completeTask(String(a.agent_id), String(a.task_id), a.refs as string[] | undefined),
    },
    {
      name: "post_contract",
      description:
        "Share an interface/agreement (API shapes, schemas, formats) the moment it is DECIDED — before it is implemented. Versioned, hashed, mirrored to contracts/<service>.md in your workspace.",
      shape: {
        agent_id: z.string(),
        content: z.string().describe("The contract text. May include a 'service: slug' line."),
        title: z.string().optional(),
        service: z.string().optional().describe("Slug for contracts/<service>.md. One slug per topic."),
      },
      handler: (a) =>
        store.postContract(
          String(a.agent_id),
          String(a.content ?? ""),
          a.title === undefined ? undefined : String(a.title),
          a.service === undefined ? undefined : String(a.service)
        ),
    },
    {
      name: "get_contracts",
      description:
        "Read contracts. Pass since_version (from your last read) for deltas. Call when you are ready to integrate — not in a polling loop.",
      shape: { since_version: z.number().optional() },
      handler: (a) => store.getContracts(a.since_version === undefined ? undefined : Number(a.since_version)),
    },
    {
      name: "post_update",
      description: "Log one-line progress for the human (shown live). Include refs when you produced something.",
      shape: {
        agent_id: z.string(),
        message: z.string(),
        refs: z.array(z.string()).optional(),
      },
      handler: (a) => store.postUpdate(String(a.agent_id), String(a.message ?? ""), a.refs as string[] | undefined),
    },
    {
      name: "get_logs",
      description: "All progress log entries from all agents.",
      shape: {},
      handler: () => store.getLogs(),
    },
    {
      name: "post_checkpoint",
      description:
        "CHECKPOINT mode: pause before/after major or irreversible work. Two lines: what you did, what you'll do next. Then call get_checkpoint_status.",
      shape: {
        agent_id: z.string(),
        summary: z.string().describe("What you completed."),
        next_step: z.string().describe("What you intend to do next."),
      },
      handler: (a) => store.postCheckpoint(String(a.agent_id), String(a.summary ?? ""), String(a.next_step ?? "")),
    },
    {
      name: "get_checkpoint_status",
      description:
        "Check your pending checkpoint: pending | approved | feedback (+ feedback text). Pass wait:true to block until resolved (retry on {pending:true}).",
      shape: { agent_id: z.string(), wait: z.boolean().optional() },
      handler: (a) =>
        a.wait === true
          ? store.awaitCheckpoint(String(a.agent_id), longPollMs())
          : store.getCheckpointStatus(String(a.agent_id)),
    },
    {
      name: "get_resume_brief",
      description:
        "Condensed restart context: goal, your remaining items, contracts in force, peer completions, latest feedback. Call this first when resuming after an interruption.",
      shape: { agent_id: z.string() },
      handler: (a) => store.resumeBrief(String(a.agent_id)),
    },
    {
      name: "get_status",
      description: "Full session status snapshot (phases, agents, board counts).",
      shape: {},
      handler: () => store.getStatus(),
    },
  ];
}

/** Uniform result envelope for MCP text content. */
export function toTextResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

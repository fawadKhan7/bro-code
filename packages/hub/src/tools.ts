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
        plan_summary: z
          .string()
          .optional()
          .describe(
            "2-3 plain-language sentences for the human reviewer: what you'll build and in what order. Not for the items — for the person deciding whether to approve."
          ),
      },
      handler: (a) =>
        store.postPlan(
          String(a.agent_id),
          (a.items ?? []) as never,
          a.plan_summary === undefined ? undefined : String(a.plan_summary)
        ),
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
        "Share an interface/agreement (API shapes, schemas, formats) the moment it is DECIDED — before it is implemented. Versioned, hashed, mirrored to contracts/<service>.md in your workspace. Structure the content as: 'What was decided' / 'The interface' / 'Example'.",
      shape: {
        agent_id: z.string(),
        summary: z
          .string()
          .optional()
          .describe(
            "ONE plain-language sentence stating what was decided, for a human reader — always provide it. E.g. 'Login returns a JWT token plus the user's id and email.'"
          ),
        content: z.string().describe("The full contract text (What was decided / The interface / Example). May include a 'service: slug' line."),
        title: z.string().optional(),
        service: z.string().optional().describe("Slug for contracts/<service>.md. One slug per topic."),
      },
      handler: (a) =>
        store.postContract(
          String(a.agent_id),
          String(a.content ?? ""),
          a.title === undefined ? undefined : String(a.title),
          a.service === undefined ? undefined : String(a.service),
          a.summary === undefined ? undefined : String(a.summary)
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
      name: "post_chat",
      description:
        "Send a conversational message TO THE USER in the session chat. Plain language, written to be read by a person: what you did and why, something you found they should know, or an answer to their chat message. ALWAYS send one before you finish — a short summary of what you did, what works now, and anything left. (For machine-style progress lines keep using post_update.)",
      shape: {
        agent_id: z.string(),
        text: z.string().describe("Your message to the user. Short paragraphs, no jargon."),
      },
      handler: (a) => store.postChat(String(a.agent_id), String(a.text ?? "")),
    },
    {
      name: "get_chat",
      description:
        "Read the user↔agent chat. The user posts follow-up instructions here — check it after completing each task and before declaring yourself done. Pass since_id (the highest id you have seen) for only new messages. Act on messages addressed to \"all\" or to your agent id, and reply with post_chat. Pass wait:true to block until a new message for you arrives (retry on {pending:true}).",
      shape: {
        agent_id: z.string(),
        since_id: z.number().optional().describe("Highest message id you have already read."),
        wait: z.boolean().optional(),
      },
      handler: (a) => {
        const since = a.since_id === undefined ? 0 : Number(a.since_id);
        return a.wait === true
          ? store.awaitChat(String(a.agent_id), since, longPollMs())
          : store.getChat(since);
      },
    },
    {
      name: "post_checkpoint",
      description:
        "Pause for the user before/after major or irreversible work — OR to ask a question. Write for a non-engineer: plain language, no jargon. Then poll get_checkpoint_status. Set kind:'question' when you only need an answer (you will take no action until the user replies via feedback).",
      shape: {
        agent_id: z.string(),
        summary: z.string().describe("What you completed (plain language)."),
        next_step: z.string().describe("What you intend to do next (plain language)."),
        why: z
          .string()
          .optional()
          .describe("Why you're pausing / what the user's approval means. Plain language, no jargon."),
        impact: z.string().optional().describe("What happens if the user approves. Plain language."),
        kind: z
          .enum(["checkpoint", "question"])
          .optional()
          .describe("'question' = you're only asking; take no action until answered via feedback."),
      },
      handler: (a) =>
        store.postCheckpoint(String(a.agent_id), String(a.summary ?? ""), String(a.next_step ?? ""), {
          why: a.why === undefined ? undefined : String(a.why),
          impact: a.impact === undefined ? undefined : String(a.impact),
          kind: a.kind === "question" ? "question" : "checkpoint",
        }),
    },
    {
      name: "get_checkpoint_status",
      description:
        "Check your pending checkpoint/question: pending | approved | feedback (+ feedback text). For a question, wait for status 'feedback' — that carries the user's answer — then act on it. Pass wait:true to block until resolved (retry on {pending:true}).",
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

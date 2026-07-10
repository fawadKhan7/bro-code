/** Fake agent — a scripted MCP client playing an agent deterministically.
 *  Uses the official SDK client over streamable HTTP, so every test also
 *  exercises the real transport. See docs/03-core-concepts/fake-agents.md.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { PlanItemInput } from "@duo/shared";

type ToolResult = Record<string, unknown> & { ok?: boolean; error?: string; phase?: string };

export class FakeAgent {
  private client: Client;
  private transport: StreamableHTTPClientTransport;

  private constructor(
    readonly id: string,
    readonly workspace: string,
    hubUrl: string
  ) {
    this.transport = new StreamableHTTPClientTransport(new URL(`${hubUrl}/mcp`));
    this.client = new Client({ name: `fake-agent-${id}`, version: "0.1.0" });
  }

  static async connect(hubUrl: string, opts: { id: string; workspace: string }): Promise<FakeAgent> {
    const agent = new FakeAgent(opts.id, opts.workspace, hubUrl);
    await agent.client.connect(agent.transport);
    return agent;
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /** Generic tool call; parses the JSON text content the hub returns. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const result = await this.client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === "text")?.text ?? "null";
    if (result.isError) {
      // Schema-level rejection (e.g. zod validation) — surface as a structured rejection.
      return { ok: false, error: text };
    }
    return JSON.parse(text) as ToolResult;
  }

  async listTools(): Promise<string[]> {
    const res = await this.client.listTools();
    return res.tools.map((t) => t.name);
  }

  // ── Protocol shorthands ───────────────────────────────────────────────────

  register(): Promise<ToolResult> {
    return this.call("register_agent", { agent_id: this.id, workspace_path: this.workspace });
  }

  sessionBrief(): Promise<ToolResult> {
    return this.call("get_session_brief", { agent_id: this.id });
  }

  postPlan(items: PlanItemInput[]): Promise<ToolResult> {
    return this.call("post_plan", { agent_id: this.id, items });
  }

  awaitPlanApproval(): Promise<ToolResult> {
    return this.call("await_plan_approval", { agent_id: this.id });
  }

  /** Keeps calling await_plan_approval through {pending,retry} timeouts — kickoff behavior. */
  async awaitPlanApprovalUntilDecided(maxRetries = 10): Promise<ToolResult> {
    for (let i = 0; i < maxRetries; i++) {
      const res = await this.awaitPlanApproval();
      if (!res.pending) return res;
    }
    throw new Error("plan approval never decided");
  }

  planStatus(): Promise<ToolResult> {
    return this.call("get_plan_status", { agent_id: this.id });
  }

  getBoard(sinceVersion?: number): Promise<ToolResult> {
    return this.call("get_board", sinceVersion === undefined ? {} : { since_version: sinceVersion });
  }

  claim(taskId: string): Promise<ToolResult> {
    return this.call("claim_task", { agent_id: this.id, task_id: taskId });
  }

  complete(taskId: string, refs?: string[]): Promise<ToolResult> {
    return this.call("complete_task", { agent_id: this.id, task_id: taskId, refs });
  }

  postContract(content: string, opts?: { title?: string; service?: string }): Promise<ToolResult> {
    return this.call("post_contract", { agent_id: this.id, content, ...opts });
  }

  getContracts(sinceVersion?: number): Promise<ToolResult> {
    return this.call("get_contracts", sinceVersion === undefined ? {} : { since_version: sinceVersion });
  }

  postUpdate(message: string, refs?: string[]): Promise<ToolResult> {
    return this.call("post_update", { agent_id: this.id, message, refs });
  }

  postCheckpoint(summary: string, nextStep: string): Promise<ToolResult> {
    return this.call("post_checkpoint", { agent_id: this.id, summary, next_step: nextStep });
  }

  checkpointStatus(wait = false): Promise<ToolResult> {
    return this.call("get_checkpoint_status", { agent_id: this.id, wait });
  }

  resumeBrief(): Promise<ToolResult> {
    return this.call("get_resume_brief", { agent_id: this.id });
  }

  status(): Promise<ToolResult> {
    return this.call("get_status");
  }
}

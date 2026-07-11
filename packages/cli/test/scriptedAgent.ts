/** A fake adapter whose launch() connects a scripted MCP client instead of spawning a process.
 *  Lets the CLI's SessionRun orchestration be tested end-to-end without AI tokens.
 */
import { EventEmitter } from "events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentAdapter, AgentHandle, DetectResult, LaunchContext } from "@duo/adapters";

export class ScriptClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;

  constructor(readonly id: string, readonly workspace: string, hubUrl: string) {
    this.transport = new StreamableHTTPClientTransport(new URL(`${hubUrl}/mcp`));
    this.client = new Client({ name: `script-${id}`, version: "0.1.0" });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }
  async close(): Promise<void> {
    await this.client.close();
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const res = await this.client.callTool({ name, arguments: args });
    const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === "text")?.text ?? "null";
    if (res.isError) return { ok: false, error: text };
    return JSON.parse(text) as Record<string, unknown>;
  }

  register() {
    return this.call("register_agent", { agent_id: this.id, workspace_path: this.workspace });
  }
  postPlan(items: unknown[]) {
    return this.call("post_plan", { agent_id: this.id, items });
  }
  async awaitApproval(maxRetries = 20): Promise<Record<string, unknown>> {
    for (let i = 0; i < maxRetries; i++) {
      const res = await this.call("await_plan_approval", { agent_id: this.id });
      if (!res.pending) return res;
    }
    throw new Error("plan never approved");
  }
  getBoard(sinceVersion?: number) {
    return this.call("get_board", sinceVersion === undefined ? {} : { since_version: sinceVersion });
  }
  claim(taskId: string) {
    return this.call("claim_task", { agent_id: this.id, task_id: taskId });
  }
  complete(taskId: string, refs: string[] = []) {
    return this.call("complete_task", { agent_id: this.id, task_id: taskId, refs });
  }
  postContract(content: string, service?: string) {
    return this.call("post_contract", { agent_id: this.id, content, service });
  }
  resumeBrief() {
    return this.call("get_resume_brief", { agent_id: this.id });
  }
}

export type AgentScript = (client: ScriptClient, ctx: LaunchContext) => Promise<void>;

class ScriptHandle implements AgentHandle {
  readonly kind: "process" | "manual";
  readonly events = new EventEmitter();
  private _exited = false;
  private client: ScriptClient;

  constructor(ctx: LaunchContext, script: AgentScript, kind: "process" | "manual" = "process") {
    this.kind = kind;
    this.client = new ScriptClient(ctx.agent.id, ctx.agent.workspace, ctx.hubUrl);
    void this.run(ctx, script);
  }

  private async run(ctx: LaunchContext, script: AgentScript): Promise<void> {
    try {
      await this.client.connect();
      await script(this.client, ctx);
      this.emit(0);
    } catch (err) {
      this.events.emit("error", err instanceof Error ? err : new Error(String(err)));
      this.emit(1);
    }
  }

  private emit(code: number): void {
    if (this._exited) return;
    this._exited = true;
    // Let any in-flight hub writes settle before signaling exit.
    setTimeout(() => this.events.emit("exit", { code }), 20);
  }

  get exited(): boolean {
    return this._exited;
  }

  async stop(): Promise<void> {
    this._exited = true;
    await this.client.close().catch(() => undefined);
  }
}

export interface ScriptedAdapterOptions {
  /** Script per agent id for the initial launch. */
  scripts: Record<string, AgentScript>;
  /** Optional script per agent id for relaunch (resume). Falls back to `scripts`. */
  resumeScripts?: Record<string, AgentScript>;
  detect?: DetectResult;
  /** Agent ids whose handles should report kind:"manual" (cursor-ide simulation). */
  manualAgents?: string[];
}

export class ScriptedAdapter implements AgentAdapter {
  readonly runner = "fake" as const;
  private launchCount = new Map<string, number>();
  configureCalls: LaunchContext[] = [];

  constructor(private opts: ScriptedAdapterOptions) {}

  async detect(): Promise<DetectResult> {
    return this.opts.detect ?? { ok: true, version: "scripted" };
  }

  async configure(ctx: LaunchContext): Promise<void> {
    this.configureCalls.push(ctx);
  }

  async launch(ctx: LaunchContext): Promise<AgentHandle> {
    const n = (this.launchCount.get(ctx.agent.id) ?? 0) + 1;
    this.launchCount.set(ctx.agent.id, n);
    const script =
      n > 1
        ? this.opts.resumeScripts?.[ctx.agent.id] ?? this.opts.scripts[ctx.agent.id]
        : this.opts.scripts[ctx.agent.id];
    const kind = this.opts.manualAgents?.includes(ctx.agent.id) ? "manual" : "process";
    return new ScriptHandle(ctx, script, kind);
  }
}

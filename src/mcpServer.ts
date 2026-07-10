import * as http from "http";
import { DUO_MCP_TOOL_SCHEMAS } from "./mcpToolCatalog";
import { hashContent, resolveServiceSlug, writeContractRevisionToDisk } from "./contractDisk";

export type AgentId = "A" | "B";
export type Mode = "auto-run" | "checkpoint";
export type CheckpointStatus = "pending" | "approved" | "feedback";

export interface Registration {
  workspacePath: string;
  connectedAt: string;
}

export interface Task {
  agentId: AgentId;
  description: string;
  context: string;
  workspacePath: string;
}

export interface LogEntry {
  agentId: AgentId;
  message: string;
  timestamp: string;
}

export interface Contract {
  agentId: AgentId;
  content: string;
  timestamp: string;
  /** SHA-256 hex of `content` — compare across sessions to detect drift. */
  contentHash: string;
  /** Monotonic revision for this `service` slug in the current server session. */
  revision: number;
  title?: string;
  /** Filename slug under `contracts/<service>.md`. */
  service?: string;
  /** Absolute path written by the disk mirror, if successful. */
  diskPath?: string;
}

export interface Checkpoint {
  agentId: AgentId;
  summary: string;
  nextStep: string;
  status: CheckpointStatus;
  feedback?: string;
  timestamp: string;
}

interface ServerState {
  registrations: Record<AgentId, Registration | null>;
  tasks: Record<AgentId, Task | null>;
  mode: Mode;
  /** Set true when that agent first calls get_my_task (chat+MCP). Both required before full task is returned. */
  armed: Record<AgentId, boolean>;
  logs: LogEntry[];
  contracts: Contract[];
  checkpoints: Record<AgentId, Checkpoint | null>;
  running: boolean;
  /** Next revision index per service slug (disk + memory). */
  contractRevisionBySlug: Record<string, number>;
}

export type PanelUpdateCallback = (event: {
  type: "log" | "checkpoint" | "status" | "registration";
  data: unknown;
}) => void;

export class DuoAgentMcpServer {
  private httpServer: http.Server | null = null;
  private sseClients: Map<string, http.ServerResponse> = new Map();
  private panelSubscribers: Set<http.ServerResponse> = new Set();
  private clientCounter = 0;
  private port = 3131;

  private state: ServerState = {
    registrations: { A: null, B: null },
    tasks: { A: null, B: null },
    mode: "auto-run",
    armed: { A: false, B: false },
    logs: [],
    contracts: [],
    checkpoints: { A: null, B: null },
    running: false,
    contractRevisionBySlug: {},
  };

  private onPanelUpdate: PanelUpdateCallback;

  constructor(onPanelUpdate: PanelUpdateCallback) {
    this.onPanelUpdate = onPanelUpdate;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(port = 3131): Promise<void> {
    this.port = port;
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(200);
          res.end();
          return;
        }

        const urlPath = req.url?.split("?")[0] ?? "";

        // ── Health check ─────────────────────────────────────────────────────
        if (req.method === "GET" && urlPath === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, port: this.port }));
          return;
        }

        // ── Panel REST API ────────────────────────────────────────────────────
        if (req.method === "POST" && urlPath === "/api/register") {
          this.readBody(req, (body) => {
            const { workspace_path } = body as { workspace_path: string };
            const result = this.registerAgent(workspace_path);
            if ("error" in result) {
              res.writeHead(409, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } else {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            }
          });
          return;
        }

        if (req.method === "POST" && urlPath === "/api/deregister") {
          this.readBody(req, (body) => {
            const { agent_id } = body as { agent_id: AgentId };
            this.deregisterAgent(agent_id);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }

        if (req.method === "POST" && urlPath === "/api/task") {
          this.readBody(req, (body) => {
            const { agent_id, task, mode } = body as {
              agent_id: AgentId;
              task: string;
              mode: Mode;
            };
            this.assignSingleTask(agent_id, task, mode);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }

        if (req.method === "POST" && urlPath === "/api/resolve-checkpoint") {
          this.readBody(req, (body) => {
            const { agent_id, approved, feedback } = body as {
              agent_id: AgentId;
              approved: boolean;
              feedback?: string;
            };
            this.resolveCheckpoint(agent_id, approved, feedback);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }

        if (req.method === "POST" && urlPath === "/api/arm") {
          this.readBody(req, (body) => {
            const result = this.setArmed(body as { agent_id?: string; armed?: boolean });
            if ("error" in result) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } else {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            }
          });
          return;
        }

        if (req.method === "GET" && urlPath === "/api/status") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ...this.getStatus(),
              registrations: this.getRegistrationStatus(),
            })
          );
          return;
        }

        // ── Panel update stream (for non-host windows) ────────────────────────
        if (req.method === "GET" && urlPath === "/api/updates") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(": keepalive\n\n");

          // Send current state immediately so the connecting window syncs
          const initEvent = {
            type: "registration",
            data: this.getRegistrationStatus(),
          };
          res.write(`data: ${JSON.stringify(initEvent)}\n\n`);

          this.panelSubscribers.add(res);
          req.on("close", () => this.panelSubscribers.delete(res));
          return;
        }

        // ── MCP SSE transport ─────────────────────────────────────────────────
        if (req.method === "GET" && urlPath === "/sse") {
          this.handleSseConnection(req, res, port);
          return;
        }

        if (req.method === "POST" && urlPath === "/message") {
          this.handleMessagePost(req, res);
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });

      this.httpServer.on("error", reject);
      this.httpServer.listen(port, "127.0.0.1", () => {
        this.state.running = true;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.state.running = false;
      this.state.registrations = { A: null, B: null };
      this.state.tasks = { A: null, B: null };
      this.state.armed = { A: false, B: false };
      this.state.logs = [];
      this.state.contracts = [];
      this.state.contractRevisionBySlug = {};
      this.state.checkpoints = { A: null, B: null };

      for (const res of this.sseClients.values()) {
        try { res.end(); } catch { /* ignore */ }
      }
      for (const res of this.panelSubscribers) {
        try { res.end(); } catch { /* ignore */ }
      }
      this.sseClients.clear();
      this.panelSubscribers.clear();
      this.httpServer?.close(() => resolve());
    });
  }

  isRunning(): boolean {
    return this.state.running;
  }

  // ── Registration ───────────────────────────────────────────────────────────

  registerAgent(workspacePath: string): { agentId: AgentId } | { error: string } {
    for (const id of ["A", "B"] as AgentId[]) {
      if (this.state.registrations[id]?.workspacePath === workspacePath) {
        return { agentId: id };
      }
    }
    for (const id of ["A", "B"] as AgentId[]) {
      if (!this.state.registrations[id]) {
        this.state.registrations[id] = {
          workspacePath,
          connectedAt: new Date().toISOString(),
        };
        this.emit({ type: "registration", data: this.getRegistrationStatus() });
        return { agentId: id };
      }
    }
    return { error: "Both agent slots are already taken. Stop the server to reset." };
  }

  deregisterAgent(agentId: AgentId): void {
    this.state.registrations[agentId] = null;
    this.state.tasks[agentId] = null;
    this.state.armed = { A: false, B: false };
    this.emit({ type: "registration", data: this.getRegistrationStatus() });
    this.emit({ type: "status", data: this.getStatus() });
  }

  getRegistrationStatus(): { A: Registration | null; B: Registration | null } {
    return { A: this.state.registrations.A, B: this.state.registrations.B };
  }

  // ── Task assignment ────────────────────────────────────────────────────────

  assignSingleTask(agentId: AgentId, task: string, mode: Mode): void {
    this.state.armed = { A: false, B: false };

    const other: AgentId = agentId === "A" ? "B" : "A";
    const workspacePath = this.state.registrations[agentId]?.workspacePath ?? "unknown";

    const context =
      `You are Agent ${agentId} collaborating with another AI agent (Agent ${other}) on a shared project.\n` +
      `Your workspace folder is: ${workspacePath}\n` +
      `Work exclusively inside that folder unless instructed otherwise.\n\n` +
      `Coordination rules:\n` +
      `- Use 'post_contract' to share interfaces, API shapes, or data formats with Agent ${other}.\n` +
      `- Use 'get_contracts' regularly to stay aligned with Agent ${other}.\n` +
      `- Use 'post_update' to log your progress (shown in the Duo Agent panel).\n` +
      (mode === "checkpoint"
        ? `- CHECKPOINT mode: call 'post_checkpoint' before any major or irreversible action and wait for user approval via 'get_checkpoint_status'.`
        : `- AUTO-RUN mode: work until your task is fully complete without stopping.`);

    this.state.tasks[agentId] = { agentId, description: task, context, workspacePath };
    this.state.mode = mode;

    this.emit({ type: "status", data: this.getStatus() });
  }

  // ── Checkpoint ─────────────────────────────────────────────────────────────

  resolveCheckpoint(agentId: AgentId, approved: boolean, feedback?: string): void {
    const cp = this.state.checkpoints[agentId];
    if (!cp) return;
    cp.status = approved ? "approved" : "feedback";
    if (feedback) cp.feedback = feedback;
    this.emit({ type: "status", data: this.getStatus() });
  }

  // ── Status / config ────────────────────────────────────────────────────────

  getStatus() {
    const armedA = this.state.armed.A;
    const armedB = this.state.armed.B;
    const taskA = this.state.tasks.A?.description ?? null;
    const taskB = this.state.tasks.B?.description ?? null;
    return {
      running: this.state.running,
      mode: this.state.mode,
      taskA,
      taskB,
      workspaceA: this.state.registrations.A?.workspacePath ?? null,
      workspaceB: this.state.registrations.B?.workspacePath ?? null,
      armedA,
      armedB,
      sessionReady: !!(taskA && taskB && armedA && armedB),
      checkpointA: this.state.checkpoints.A,
      checkpointB: this.state.checkpoints.B,
      logCount: this.state.logs.length,
      contractCount: this.state.contracts.length,
    };
  }

  /**
   * REST: arm / disarm agents. Arming requires a task already assigned for that slot.
   * agent_id "both" sets both (requires both tasks when arming true).
   */
  setArmed(body: { agent_id?: string; armed?: boolean }): { ok: true; armed: Record<AgentId, boolean> } | { error: string } {
    const armed = body.armed !== false;
    const raw = (body.agent_id ?? "").toString().toUpperCase();

    if (raw === "BOTH") {
      if (armed && (!this.state.tasks.A || !this.state.tasks.B)) {
        return { error: "Cannot arm both: tasks must be set for Agent A and Agent B first." };
      }
      this.state.armed.A = armed;
      this.state.armed.B = armed;
    } else if (raw === "A" || raw === "B") {
      const id = raw as AgentId;
      if (armed && !this.state.tasks[id]) {
        return { error: `Cannot arm Agent ${id}: set a task for Agent ${id} first.` };
      }
      this.state.armed[id] = armed;
    } else {
      return { error: "agent_id must be A, B, or both" };
    }

    this.emit({ type: "status", data: this.getStatus() });
    return { ok: true, armed: { A: this.state.armed.A, B: this.state.armed.B } };
  }

  getMcpConfigSnippet(port = 3131): string {
    return JSON.stringify(
      { mcpServers: { "duo-agent": { url: `http://127.0.0.1:${port}/sse` } } },
      null,
      2
    );
  }

  // ── Broadcast to all panel subscribers (non-host windows) ─────────────────

  private emit(event: { type: string; data: unknown }): void {
    this.onPanelUpdate(event as Parameters<PanelUpdateCallback>[0]);

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const sub of this.panelSubscribers) {
      if (!sub.destroyed) {
        try { sub.write(data); } catch { this.panelSubscribers.delete(sub); }
      } else {
        this.panelSubscribers.delete(sub);
      }
    }
  }

  // ── MCP SSE transport ──────────────────────────────────────────────────────

  private handleSseConnection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    port: number
  ): void {
    const clientId = String(++this.clientCounter);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: endpoint\ndata: http://127.0.0.1:${port}/message?clientId=${clientId}\n\n`);
    this.sseClients.set(clientId, res);
    req.on("close", () => this.sseClients.delete(clientId));
  }

  private handleMessagePost(req: http.IncomingMessage, res: http.ServerResponse): void {
    const urlObj = new URL(req.url ?? "", `http://127.0.0.1:${this.port}`);
    const clientId = urlObj.searchParams.get("clientId") ?? "";
    const sseRes = this.sseClients.get(clientId);

    this.readBody(req, (body) => {
      try {
        const rpcResponse = this.handleJsonRpc(body as Parameters<typeof this.handleJsonRpc>[0]);
        res.writeHead(202);
        res.end();
        if (rpcResponse !== null && sseRes && !sseRes.destroyed) {
          sseRes.write(`data: ${JSON.stringify(rpcResponse)}\n\n`);
        }
      } catch {
        res.writeHead(400);
        res.end("Bad Request");
      }
    }, true);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private readBody(
    req: http.IncomingMessage,
    callback: (parsed: unknown) => void,
    raw = false
  ): void {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        callback(raw ? JSON.parse(body) : JSON.parse(body));
      } catch {
        callback({});
      }
    });
  }

  // ── JSON-RPC 2.0 ───────────────────────────────────────────────────────────

  private handleJsonRpc(request: {
    jsonrpc: string;
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
  }): object | null {
    const { id, method, params } = request;

    if (method === "notifications/initialized") return null;

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "duo-agent", version: "0.0.6" },
        },
      };
    }

    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: [...DUO_MCP_TOOL_SCHEMAS] } };
    }

    if (method === "tools/call") {
      const toolName = (params as { name: string; arguments?: Record<string, unknown> }).name;
      const args = (params as { name: string; arguments?: Record<string, unknown> }).arguments ?? {};
      try {
        const toolResult = this.callTool(toolName, args);
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(toolResult, null, 2) }] },
        };
      } catch (err) {
        return { jsonrpc: "2.0", id, error: { code: -32000, message: String(err) } };
      }
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  // ── Tool implementations ───────────────────────────────────────────────────

  private callTool(name: string, args: Record<string, unknown>): unknown {
    switch (name) {
      case "register_agent": {
        const result = this.registerAgent(String(args.workspace_path ?? ""));
        if ("error" in result) throw new Error(result.error);
        return result;
      }
      case "get_my_task": {
        const id = String(args.agent_id ?? "") as AgentId;
        if (id !== "A" && id !== "B") throw new Error("agent_id must be A or B");
        const task = this.state.tasks[id];
        if (!task) throw new Error(`No task assigned to Agent ${id} yet.`);

        const other: AgentId = id === "A" ? "B" : "A";
        const wasReady = this.state.armed[id];
        if (!wasReady) {
          this.state.armed[id] = true;
          this.emit({ type: "status", data: this.getStatus() });
          if (this.state.armed.A && this.state.armed.B) {
            this.emit({
              type: "log",
              data: {
                agentId: id,
                message: "Both agents have called get_my_task — full task payloads are now returned.",
                timestamp: new Date().toISOString(),
              },
            });
          } else {
            this.emit({
              type: "log",
              data: {
                agentId: id,
                message: `This window called get_my_task. Waiting for Agent ${other} to call get_my_task once in their chat.`,
                timestamp: new Date().toISOString(),
              },
            });
          }
        }

        if (!this.state.armed.A || !this.state.armed.B) {
          return {
            waiting: true,
            agent_id: id,
            workspace: task.workspacePath,
            message:
              `Agent ${id} is registered from chat. Waiting for Agent ${other} to use the duo-agent MCP tool ` +
              `get_my_task once in the other Cursor window. Then call get_my_task again here to receive your full task.`,
          };
        }

        return { description: task.description, workspace: task.workspacePath, context: task.context };
      }
      case "get_mode":
        return { mode: this.state.mode };
      case "post_update": {
        const entry: LogEntry = {
          agentId: String(args.agent_id ?? "") as AgentId,
          message: String(args.message ?? ""),
          timestamp: new Date().toISOString(),
        };
        this.state.logs.push(entry);
        this.emit({ type: "log", data: entry });
        return { ok: true };
      }
      case "get_logs":
        return this.state.logs;
      case "post_contract": {
        const agentId = String(args.agent_id ?? "") as AgentId;
        if (agentId !== "A" && agentId !== "B") throw new Error("agent_id must be A or B");
        const content = String(args.content ?? "");
        const titleRaw = args.title !== undefined && args.title !== null ? String(args.title).trim() : "";
        const title = titleRaw || undefined;
        const serviceArg = args.service !== undefined && args.service !== null ? String(args.service).trim() : "";
        const slug = resolveServiceSlug(content, serviceArg || undefined);
        const contentHash = hashContent(content);

        const workspacePath =
          this.state.registrations[agentId]?.workspacePath ?? this.state.tasks[agentId]?.workspacePath;
        if (!workspacePath) {
          throw new Error(
            `post_contract: no workspace for Agent ${agentId}. Connect this window (register_agent / Duo panel) and ensure a task workspace is set before posting contracts.`
          );
        }
        const prevRev = this.state.contractRevisionBySlug[slug] ?? 0;
        const revision = prevRev + 1;
        const timestamp = new Date().toISOString();
        let diskPath: string;
        try {
          diskPath = writeContractRevisionToDisk(workspacePath, slug, {
            agentId,
            timestamp,
            contentHash,
            title,
            revision,
            content,
          });
        } catch (e) {
          throw new Error(`post_contract disk mirror failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        this.state.contractRevisionBySlug[slug] = revision;

        const contract: Contract = {
          agentId,
          content,
          timestamp,
          contentHash,
          revision,
          title,
          service: slug,
          diskPath,
        };
        this.state.contracts.push(contract);
        this.emit({
          type: "log",
          data: { agentId, message: "📋 Posted a contract update.", timestamp: contract.timestamp },
        });
        return { ok: true, service: slug, revision, contentHash, diskPath };
      }
      case "get_contracts":
        return this.state.contracts;
      case "post_checkpoint": {
        const cp: Checkpoint = {
          agentId: String(args.agent_id ?? "") as AgentId,
          summary: String(args.summary ?? ""),
          nextStep: String(args.next_step ?? ""),
          status: "pending",
          timestamp: new Date().toISOString(),
        };
        this.state.checkpoints[String(args.agent_id ?? "") as AgentId] = cp;
        this.emit({ type: "checkpoint", data: cp });
        return { ok: true, message: "Checkpoint recorded. Waiting for user approval." };
      }
      case "get_checkpoint_status": {
        const cp = this.state.checkpoints[String(args.agent_id ?? "") as AgentId];
        if (!cp) return { status: "none" };
        return { status: cp.status, feedback: cp.feedback ?? null };
      }
      case "get_status":
        return this.getStatus();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DuoAgentMcpServer = void 0;
const http = __importStar(require("http"));
const mcpToolCatalog_1 = require("./mcpToolCatalog");
const contractDisk_1 = require("./contractDisk");
class DuoAgentMcpServer {
    constructor(onPanelUpdate) {
        this.httpServer = null;
        this.sseClients = new Map();
        this.panelSubscribers = new Set();
        this.clientCounter = 0;
        this.port = 3131;
        this.state = {
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
        this.onPanelUpdate = onPanelUpdate;
    }
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    start(port = 3131) {
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
                        const { workspace_path } = body;
                        const result = this.registerAgent(workspace_path);
                        if ("error" in result) {
                            res.writeHead(409, { "Content-Type": "application/json" });
                            res.end(JSON.stringify(result));
                        }
                        else {
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify(result));
                        }
                    });
                    return;
                }
                if (req.method === "POST" && urlPath === "/api/deregister") {
                    this.readBody(req, (body) => {
                        const { agent_id } = body;
                        this.deregisterAgent(agent_id);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true }));
                    });
                    return;
                }
                if (req.method === "POST" && urlPath === "/api/task") {
                    this.readBody(req, (body) => {
                        const { agent_id, task, mode } = body;
                        this.assignSingleTask(agent_id, task, mode);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true }));
                    });
                    return;
                }
                if (req.method === "POST" && urlPath === "/api/resolve-checkpoint") {
                    this.readBody(req, (body) => {
                        const { agent_id, approved, feedback } = body;
                        this.resolveCheckpoint(agent_id, approved, feedback);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true }));
                    });
                    return;
                }
                if (req.method === "POST" && urlPath === "/api/arm") {
                    this.readBody(req, (body) => {
                        const result = this.setArmed(body);
                        if ("error" in result) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify(result));
                        }
                        else {
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify(result));
                        }
                    });
                    return;
                }
                if (req.method === "GET" && urlPath === "/api/status") {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        ...this.getStatus(),
                        registrations: this.getRegistrationStatus(),
                    }));
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
    stop() {
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
                try {
                    res.end();
                }
                catch { /* ignore */ }
            }
            for (const res of this.panelSubscribers) {
                try {
                    res.end();
                }
                catch { /* ignore */ }
            }
            this.sseClients.clear();
            this.panelSubscribers.clear();
            this.httpServer?.close(() => resolve());
        });
    }
    isRunning() {
        return this.state.running;
    }
    // ── Registration ───────────────────────────────────────────────────────────
    registerAgent(workspacePath) {
        for (const id of ["A", "B"]) {
            if (this.state.registrations[id]?.workspacePath === workspacePath) {
                return { agentId: id };
            }
        }
        for (const id of ["A", "B"]) {
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
    deregisterAgent(agentId) {
        this.state.registrations[agentId] = null;
        this.state.tasks[agentId] = null;
        this.state.armed = { A: false, B: false };
        this.emit({ type: "registration", data: this.getRegistrationStatus() });
        this.emit({ type: "status", data: this.getStatus() });
    }
    getRegistrationStatus() {
        return { A: this.state.registrations.A, B: this.state.registrations.B };
    }
    // ── Task assignment ────────────────────────────────────────────────────────
    assignSingleTask(agentId, task, mode) {
        this.state.armed = { A: false, B: false };
        const other = agentId === "A" ? "B" : "A";
        const workspacePath = this.state.registrations[agentId]?.workspacePath ?? "unknown";
        const context = `You are Agent ${agentId} collaborating with another AI agent (Agent ${other}) on a shared project.\n` +
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
    resolveCheckpoint(agentId, approved, feedback) {
        const cp = this.state.checkpoints[agentId];
        if (!cp)
            return;
        cp.status = approved ? "approved" : "feedback";
        if (feedback)
            cp.feedback = feedback;
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
    setArmed(body) {
        const armed = body.armed !== false;
        const raw = (body.agent_id ?? "").toString().toUpperCase();
        if (raw === "BOTH") {
            if (armed && (!this.state.tasks.A || !this.state.tasks.B)) {
                return { error: "Cannot arm both: tasks must be set for Agent A and Agent B first." };
            }
            this.state.armed.A = armed;
            this.state.armed.B = armed;
        }
        else if (raw === "A" || raw === "B") {
            const id = raw;
            if (armed && !this.state.tasks[id]) {
                return { error: `Cannot arm Agent ${id}: set a task for Agent ${id} first.` };
            }
            this.state.armed[id] = armed;
        }
        else {
            return { error: "agent_id must be A, B, or both" };
        }
        this.emit({ type: "status", data: this.getStatus() });
        return { ok: true, armed: { A: this.state.armed.A, B: this.state.armed.B } };
    }
    getMcpConfigSnippet(port = 3131) {
        return JSON.stringify({ mcpServers: { "duo-agent": { url: `http://127.0.0.1:${port}/sse` } } }, null, 2);
    }
    // ── Broadcast to all panel subscribers (non-host windows) ─────────────────
    emit(event) {
        this.onPanelUpdate(event);
        const data = `data: ${JSON.stringify(event)}\n\n`;
        for (const sub of this.panelSubscribers) {
            if (!sub.destroyed) {
                try {
                    sub.write(data);
                }
                catch {
                    this.panelSubscribers.delete(sub);
                }
            }
            else {
                this.panelSubscribers.delete(sub);
            }
        }
    }
    // ── MCP SSE transport ──────────────────────────────────────────────────────
    handleSseConnection(req, res, port) {
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
    handleMessagePost(req, res) {
        const urlObj = new URL(req.url ?? "", `http://127.0.0.1:${this.port}`);
        const clientId = urlObj.searchParams.get("clientId") ?? "";
        const sseRes = this.sseClients.get(clientId);
        this.readBody(req, (body) => {
            try {
                const rpcResponse = this.handleJsonRpc(body);
                res.writeHead(202);
                res.end();
                if (rpcResponse !== null && sseRes && !sseRes.destroyed) {
                    sseRes.write(`data: ${JSON.stringify(rpcResponse)}\n\n`);
                }
            }
            catch {
                res.writeHead(400);
                res.end("Bad Request");
            }
        }, true);
    }
    // ── Helpers ────────────────────────────────────────────────────────────────
    readBody(req, callback, raw = false) {
        let body = "";
        req.on("data", (chunk) => (body += chunk.toString()));
        req.on("end", () => {
            try {
                callback(raw ? JSON.parse(body) : JSON.parse(body));
            }
            catch {
                callback({});
            }
        });
    }
    // ── JSON-RPC 2.0 ───────────────────────────────────────────────────────────
    handleJsonRpc(request) {
        const { id, method, params } = request;
        if (method === "notifications/initialized")
            return null;
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
            return { jsonrpc: "2.0", id, result: { tools: [...mcpToolCatalog_1.DUO_MCP_TOOL_SCHEMAS] } };
        }
        if (method === "tools/call") {
            const toolName = params.name;
            const args = params.arguments ?? {};
            try {
                const toolResult = this.callTool(toolName, args);
                return {
                    jsonrpc: "2.0",
                    id,
                    result: { content: [{ type: "text", text: JSON.stringify(toolResult, null, 2) }] },
                };
            }
            catch (err) {
                return { jsonrpc: "2.0", id, error: { code: -32000, message: String(err) } };
            }
        }
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
    // ── Tool implementations ───────────────────────────────────────────────────
    callTool(name, args) {
        switch (name) {
            case "register_agent": {
                const result = this.registerAgent(String(args.workspace_path ?? ""));
                if ("error" in result)
                    throw new Error(result.error);
                return result;
            }
            case "get_my_task": {
                const id = String(args.agent_id ?? "");
                if (id !== "A" && id !== "B")
                    throw new Error("agent_id must be A or B");
                const task = this.state.tasks[id];
                if (!task)
                    throw new Error(`No task assigned to Agent ${id} yet.`);
                const other = id === "A" ? "B" : "A";
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
                    }
                    else {
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
                        message: `Agent ${id} is registered from chat. Waiting for Agent ${other} to use the duo-agent MCP tool ` +
                            `get_my_task once in the other Cursor window. Then call get_my_task again here to receive your full task.`,
                    };
                }
                return { description: task.description, workspace: task.workspacePath, context: task.context };
            }
            case "get_mode":
                return { mode: this.state.mode };
            case "post_update": {
                const entry = {
                    agentId: String(args.agent_id ?? ""),
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
                const agentId = String(args.agent_id ?? "");
                if (agentId !== "A" && agentId !== "B")
                    throw new Error("agent_id must be A or B");
                const content = String(args.content ?? "");
                const titleRaw = args.title !== undefined && args.title !== null ? String(args.title).trim() : "";
                const title = titleRaw || undefined;
                const serviceArg = args.service !== undefined && args.service !== null ? String(args.service).trim() : "";
                const slug = (0, contractDisk_1.resolveServiceSlug)(content, serviceArg || undefined);
                const contentHash = (0, contractDisk_1.hashContent)(content);
                const workspacePath = this.state.registrations[agentId]?.workspacePath ?? this.state.tasks[agentId]?.workspacePath;
                if (!workspacePath) {
                    throw new Error(`post_contract: no workspace for Agent ${agentId}. Connect this window (register_agent / Duo panel) and ensure a task workspace is set before posting contracts.`);
                }
                const prevRev = this.state.contractRevisionBySlug[slug] ?? 0;
                const revision = prevRev + 1;
                const timestamp = new Date().toISOString();
                let diskPath;
                try {
                    diskPath = (0, contractDisk_1.writeContractRevisionToDisk)(workspacePath, slug, {
                        agentId,
                        timestamp,
                        contentHash,
                        title,
                        revision,
                        content,
                    });
                }
                catch (e) {
                    throw new Error(`post_contract disk mirror failed: ${e instanceof Error ? e.message : String(e)}`);
                }
                this.state.contractRevisionBySlug[slug] = revision;
                const contract = {
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
                const cp = {
                    agentId: String(args.agent_id ?? ""),
                    summary: String(args.summary ?? ""),
                    nextStep: String(args.next_step ?? ""),
                    status: "pending",
                    timestamp: new Date().toISOString(),
                };
                this.state.checkpoints[String(args.agent_id ?? "")] = cp;
                this.emit({ type: "checkpoint", data: cp });
                return { ok: true, message: "Checkpoint recorded. Waiting for user approval." };
            }
            case "get_checkpoint_status": {
                const cp = this.state.checkpoints[String(args.agent_id ?? "")];
                if (!cp)
                    return { status: "none" };
                return { status: cp.status, feedback: cp.feedback ?? null };
            }
            case "get_status":
                return this.getStatus();
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
}
exports.DuoAgentMcpServer = DuoAgentMcpServer;
//# sourceMappingURL=mcpServer.js.map
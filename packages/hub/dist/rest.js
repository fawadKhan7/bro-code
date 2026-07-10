import { historyDir } from "@duo/shared";
async function readJson(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw)
        return {};
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}
export class RestApi {
    store;
    port;
    subscribers = new Set();
    constructor(store, port) {
        this.store = store;
        this.port = port;
        store.events.on("hub-event", (event) => this.broadcast(event));
    }
    broadcast(event) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        for (const sub of this.subscribers) {
            if (sub.destroyed) {
                this.subscribers.delete(sub);
                continue;
            }
            try {
                sub.write(data);
            }
            catch {
                this.subscribers.delete(sub);
            }
        }
    }
    closeAll() {
        for (const res of this.subscribers) {
            try {
                res.end();
            }
            catch {
                /* ignore */
            }
        }
        this.subscribers.clear();
    }
    /** Returns true if the request was handled. */
    async handle(req, res, urlPath) {
        const method = req.method ?? "GET";
        if (method === "GET" && urlPath === "/health") {
            json(res, 200, { ok: true, port: this.port, phase: this.store.getState().phase });
            return true;
        }
        if (method === "GET" && urlPath === "/api/status") {
            json(res, 200, this.store.getStatus());
            return true;
        }
        if (method === "GET" && urlPath === "/api/board") {
            json(res, 200, {
                ...this.store.getBoard(),
                proposedBoard: this.store.getState().proposedBoard,
                plan: this.store.planStatus(),
            });
            return true;
        }
        if (method === "POST" && urlPath === "/api/session") {
            const body = await readJson(req);
            const result = this.store.createSession(body);
            json(res, "error" in result ? 409 : 200, result);
            return true;
        }
        if (method === "POST" && urlPath === "/api/plan/approve") {
            const body = await readJson(req);
            const result = this.store.approvePlan((body.edits ?? body));
            json(res, "error" in result ? 409 : 200, result);
            return true;
        }
        if (method === "POST" && urlPath === "/api/plan/feedback") {
            const body = await readJson(req);
            const result = this.store.planFeedback(String(body.message ?? ""));
            json(res, "error" in result ? 409 : 200, result);
            return true;
        }
        if (method === "POST" && urlPath === "/api/checkpoint/resolve") {
            const body = await readJson(req);
            const result = this.store.resolveCheckpoint(String(body.agent_id ?? ""), body.approved !== false, body.feedback === undefined ? undefined : String(body.feedback));
            json(res, "error" in result ? 409 : 200, result);
            return true;
        }
        if (method === "POST" && urlPath === "/api/board/out-of-scope") {
            const body = await readJson(req);
            const ids = Array.isArray(body.task_ids) ? body.task_ids.map(String) : [];
            const result = this.store.markOutOfScope(ids);
            json(res, "error" in result ? 409 : 200, result);
            return true;
        }
        if (method === "POST" && urlPath === "/api/agent/release") {
            const body = await readJson(req);
            json(res, 200, this.store.releaseAgent(String(body.agent_id ?? "")));
            return true;
        }
        if (method === "POST" && urlPath === "/api/stop") {
            const archive = this.store.stopSession(historyDir());
            json(res, 200, { ok: true, archive });
            return true;
        }
        if (method === "GET" && urlPath === "/api/updates") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            });
            res.write(": keepalive\n\n");
            // Sync the connecting client immediately.
            res.write(`data: ${JSON.stringify({ type: "status", data: this.store.getStatus() })}\n\n`);
            this.subscribers.add(res);
            req.on("close", () => this.subscribers.delete(res));
            return true;
        }
        return false;
    }
}
//# sourceMappingURL=rest.js.map
import { createToolset, toTextResult } from "./tools.js";
export class LegacySseTransport {
    clients = new Map();
    counter = 0;
    toolset;
    toolByName;
    constructor(store) {
        this.toolset = createToolset(store);
        this.toolByName = new Map(this.toolset.map((t) => [t.name, t]));
    }
    handleSse(req, res, baseUrl) {
        const clientId = String(++this.counter);
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        res.write(`event: endpoint\ndata: ${baseUrl}/message?clientId=${clientId}\n\n`);
        this.clients.set(clientId, res);
        req.on("close", () => this.clients.delete(clientId));
    }
    async handleMessage(req, res) {
        const url = new URL(req.url ?? "", "http://localhost");
        const clientId = url.searchParams.get("clientId") ?? "";
        const sse = this.clients.get(clientId);
        const chunks = [];
        for await (const chunk of req)
            chunks.push(chunk);
        let request;
        try {
            request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        }
        catch {
            res.writeHead(400);
            res.end("Bad Request");
            return;
        }
        res.writeHead(202);
        res.end();
        const response = await this.dispatch(request);
        if (response !== null && sse && !sse.destroyed) {
            sse.write(`data: ${JSON.stringify(response)}\n\n`);
        }
    }
    closeAll() {
        for (const res of this.clients.values()) {
            try {
                res.end();
            }
            catch {
                /* ignore */
            }
        }
        this.clients.clear();
    }
    async dispatch(request) {
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
                    serverInfo: { name: "duo", version: "0.1.0" },
                },
            };
        }
        if (method === "tools/list") {
            return {
                jsonrpc: "2.0",
                id,
                result: {
                    tools: this.toolset.map((t) => ({
                        name: t.name,
                        description: t.description,
                        // Minimal permissive schema for the compat transport; the primary
                        // transport (SDK) serves full zod-derived schemas.
                        inputSchema: { type: "object", additionalProperties: true },
                    })),
                },
            };
        }
        if (method === "tools/call") {
            const name = String(params?.name ?? "");
            const args = (params?.arguments ?? {});
            const tool = this.toolByName.get(name);
            if (!tool) {
                return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } };
            }
            try {
                const result = await tool.handler(args);
                return { jsonrpc: "2.0", id, result: toTextResult(result) };
            }
            catch (err) {
                return { jsonrpc: "2.0", id, error: { code: -32000, message: String(err) } };
            }
        }
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
}
//# sourceMappingURL=legacySse.js.map
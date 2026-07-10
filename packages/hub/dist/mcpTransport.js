import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createToolset, toTextResult } from "./tools.js";
function buildMcpServer(store) {
    const server = new McpServer({ name: "duo", version: "0.1.0" });
    for (const tool of createToolset(store)) {
        server.tool(tool.name, tool.description, tool.shape, async (args) => {
            const result = await tool.handler(args ?? {});
            return toTextResult(result);
        });
    }
    return server;
}
async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw)
        return undefined;
    return JSON.parse(raw);
}
export async function handleMcpRequest(store, req, res) {
    if (req.method === "GET" || req.method === "DELETE") {
        // Stateless mode: no server-push stream, no sessions to delete.
        res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
        res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed. POST JSON-RPC to /mcp." },
            id: null,
        }));
        return;
    }
    let body;
    try {
        body = await readJsonBody(req);
    }
    catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
        return;
    }
    const server = buildMcpServer(store);
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
        enableJsonResponse: true,
    });
    res.on("close", () => {
        void transport.close();
        void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
}
//# sourceMappingURL=mcpTransport.js.map
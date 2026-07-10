/** MCP streamable HTTP transport (primary) — official SDK, stateless mode.
 *  A fresh McpServer+transport pair per request keeps the hub free of MCP session
 *  bookkeeping; all real state lives in the SessionStore. Long-poll tools work because
 *  the HTTP response is simply held until the handler's promise resolves.
 */
import type { IncomingMessage, ServerResponse } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { SessionStore } from "./store.js";
import { createToolset, toTextResult } from "./tools.js";

function buildMcpServer(store: SessionStore): McpServer {
  const server = new McpServer({ name: "duo", version: "0.1.0" });
  for (const tool of createToolset(store)) {
    server.tool(tool.name, tool.description, tool.shape, async (args: Record<string, unknown>) => {
      const result = await tool.handler(args ?? {});
      return toTextResult(result);
    });
  }
  return server;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

export async function handleMcpRequest(
  store: SessionStore,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === "GET" || req.method === "DELETE") {
    // Stateless mode: no server-push stream, no sessions to delete.
    res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed. POST JSON-RPC to /mcp." },
        id: null,
      })
    );
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null })
    );
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

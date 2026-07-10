/** MCP legacy HTTP+SSE transport (compat) — ported from the gen-1 extension server.
 *  Kept for MCP clients that predate streamable HTTP. Fronts the same toolset.
 *  Protocol: GET /sse → `endpoint` event → client POSTs JSON-RPC to /message?clientId=N;
 *  responses are written to the SSE stream, the POST returns 202.
 */
import type { IncomingMessage, ServerResponse } from "http";
import { createToolset, toTextResult, type ToolDef } from "./tools.js";
import type { SessionStore } from "./store.js";

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export class LegacySseTransport {
  private clients = new Map<string, ServerResponse>();
  private counter = 0;
  private toolset: ToolDef[];
  private toolByName: Map<string, ToolDef>;

  constructor(store: SessionStore) {
    this.toolset = createToolset(store);
    this.toolByName = new Map(this.toolset.map((t) => [t.name, t]));
  }

  handleSse(req: IncomingMessage, res: ServerResponse, baseUrl: string): void {
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

  async handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "", "http://localhost");
    const clientId = url.searchParams.get("clientId") ?? "";
    const sse = this.clients.get(clientId);

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonRpcRequest;
    } catch {
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

  closeAll(): void {
    for (const res of this.clients.values()) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  private async dispatch(request: JsonRpcRequest): Promise<object | null> {
    const { id, method, params } = request;

    if (method === "notifications/initialized") return null;

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
      const name = String((params as { name?: unknown })?.name ?? "");
      const args = ((params as { arguments?: unknown })?.arguments ?? {}) as Record<string, unknown>;
      const tool = this.toolByName.get(name);
      if (!tool) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } };
      }
      try {
        const result = await tool.handler(args);
        return { jsonrpc: "2.0", id, result: toTextResult(result) };
      } catch (err) {
        return { jsonrpc: "2.0", id, error: { code: -32000, message: String(err) } };
      }
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

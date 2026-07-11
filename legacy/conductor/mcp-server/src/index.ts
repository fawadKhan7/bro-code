#!/usr/bin/env node
import { CONDUCTOR_TOOL_SCHEMAS } from "./schemas";
import { callConductorTool } from "./tools";
import { createStdioReader, writeMessage } from "./stdio";

function handleRequest(request: Record<string, unknown>): void {
  const id = request.id;
  const method = String(request.method ?? "");
  const params = (request.params ?? {}) as Record<string, unknown>;

  if (method === "notifications/initialized") return;

  if (method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "conductor", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: { tools: [...CONDUCTOR_TOOL_SCHEMAS] },
    });
    return;
  }

  if (method === "tools/call") {
    const toolName = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = callConductorTool(toolName, args);
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      writeMessage({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      });
    }
    return;
  }

  if (id !== undefined) {
    writeMessage({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

createStdioReader(handleRequest);

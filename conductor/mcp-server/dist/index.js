#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schemas_1 = require("./schemas");
const tools_1 = require("./tools");
const stdio_1 = require("./stdio");
function handleRequest(request) {
    const id = request.id;
    const method = String(request.method ?? "");
    const params = (request.params ?? {});
    if (method === "notifications/initialized")
        return;
    if (method === "initialize") {
        (0, stdio_1.writeMessage)({
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
        (0, stdio_1.writeMessage)({
            jsonrpc: "2.0",
            id,
            result: { tools: [...schemas_1.CONDUCTOR_TOOL_SCHEMAS] },
        });
        return;
    }
    if (method === "tools/call") {
        const toolName = String(params.name ?? "");
        const args = (params.arguments ?? {});
        try {
            const result = (0, tools_1.callConductorTool)(toolName, args);
            (0, stdio_1.writeMessage)({
                jsonrpc: "2.0",
                id,
                result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
            });
        }
        catch (err) {
            (0, stdio_1.writeMessage)({
                jsonrpc: "2.0",
                id,
                error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
            });
        }
        return;
    }
    if (id !== undefined) {
        (0, stdio_1.writeMessage)({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
}
(0, stdio_1.createStdioReader)(handleRequest);
//# sourceMappingURL=index.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONDUCTOR_TOOL_SCHEMAS = void 0;
exports.CONDUCTOR_TOOL_SCHEMAS = [
    {
        name: "get_contract",
        description: "Returns contract updates from the other agent since sinceVersion. Use before starting work that depends on peer output.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: {
                    type: "string",
                    description: "Your agent id: agent-a or agent-b",
                },
                sinceVersion: {
                    type: "number",
                    description: "Last version you processed. Omit or 0 for all updates.",
                },
            },
            required: ["agent_id"],
        },
    },
    {
        name: "post_update",
        description: "Publish a structured update the other agent depends on.",
        inputSchema: {
            type: "object",
            properties: {
                from: { type: "string", description: "agent-a or agent-b" },
                type: { type: "string", description: "e.g. endpoint, schema, ui, event" },
                summary: { type: "string", description: "One-line summary" },
                diff: {
                    type: "object",
                    properties: {
                        added: { type: "array", items: { type: "string" } },
                        removed: { type: "array", items: { type: "string" } },
                        changed: { type: "array", items: { type: "string" } },
                    },
                },
                refs: {
                    type: "array",
                    items: { type: "string" },
                    description: "File paths relative to project root for the peer to open",
                },
            },
            required: ["from", "type", "summary"],
        },
    },
    {
        name: "post_checkpoint",
        description: "Signal a major milestone; session pauses until user runs conductor feedback.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "agent-a or agent-b" },
                summary: { type: "string", description: "What was completed" },
                next_step: { type: "string", description: "What you plan next" },
            },
            required: ["agent_id", "summary", "next_step"],
        },
    },
    {
        name: "get_resume_brief",
        description: "After checkpoint resume, returns condensed context. Call once after user feedback.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "agent-a or agent-b" },
            },
            required: ["agent_id"],
        },
    },
    {
        name: "get_status",
        description: "Session status, peer checkpoints, and latest contract version.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: {
                    type: "string",
                    description: "Optional: agent-a or agent-b for peer-focused view",
                },
            },
        },
    },
];
//# sourceMappingURL=schemas.js.map
"use strict";
/**
 * Single source of truth for MCP tool definitions and Cursor rule generation.
 * When tools change, re-run "Duo: Install Protocol Rules" so `.cursor/rules/duo-protocol.mdc` stays aligned.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUO_MCP_TOOL_SCHEMAS = void 0;
exports.buildDuoProtocolMdc = buildDuoProtocolMdc;
exports.DUO_MCP_TOOL_SCHEMAS = [
    {
        name: "register_agent",
        description: "Register this Cursor window as an agent in the Duo Agent session. Returns the assigned agent ID (A or B) and workspace path. Call this once at the start of a session.",
        inputSchema: {
            type: "object",
            properties: {
                workspace_path: {
                    type: "string",
                    description: "Absolute path of the workspace folder this agent is working in",
                },
            },
            required: ["workspace_path"],
        },
    },
    {
        name: "get_my_task",
        description: "Returns the task for this agent (A or B). First successful call from each agent window records that agent as ready. Until BOTH agents have called get_my_task once, the response includes waiting: true — then poll again to receive the full task.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Agent ID — must be 'A' or 'B'" },
            },
            required: ["agent_id"],
        },
    },
    {
        name: "get_mode",
        description: "Returns the current collaboration mode: 'auto-run' or 'checkpoint'.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "post_update",
        description: "Log a progress update visible in the Duo Agent panel.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Agent ID — 'A' or 'B'" },
                message: {
                    type: "string",
                    description: "Progress message. If blocked waiting on the other agent, start with BLOCKED: and explain.",
                },
            },
            required: ["agent_id", "message"],
        },
    },
    {
        name: "get_logs",
        description: "Returns all progress logs from both agents.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "post_contract",
        description: "Share an interface, data format, or agreement with the other agent. Also writes contracts/<service>.md under this agent's workspace (immediate disk mirror).",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Agent ID — 'A' or 'B'" },
                content: {
                    type: "string",
                    description: "Contract body. Optionally start with a line service: <slug> (slug: lowercase letters, digits, hyphens).",
                },
                title: { type: "string", description: "Short human-readable title for this contract revision." },
                service: {
                    type: "string",
                    description: "Service slug for filename (e.g. auth-api). If omitted, parsed from content line service: <slug> or a stable default slug is used.",
                },
            },
            required: ["agent_id", "content"],
        },
    },
    {
        name: "get_contracts",
        description: "Returns all shared contracts posted by both agents in this session, each with contentHash, timestamp, optional title/service, and revision version for staleness checks.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "post_checkpoint",
        description: "Pause at a milestone and request user approval before continuing (Checkpoint mode only).",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Agent ID — 'A' or 'B'" },
                summary: { type: "string", description: "What has been completed so far" },
                next_step: { type: "string", description: "What the agent intends to do next" },
            },
            required: ["agent_id", "summary", "next_step"],
        },
    },
    {
        name: "get_checkpoint_status",
        description: "Poll to check whether the user approved or gave feedback on a checkpoint.",
        inputSchema: {
            type: "object",
            properties: {
                agent_id: { type: "string", description: "Agent ID — 'A' or 'B'" },
            },
            required: ["agent_id"],
        },
    },
    {
        name: "get_status",
        description: "Returns the current task state and both agents' progress summary.",
        inputSchema: { type: "object", properties: {} },
    },
];
function schemaSummary(schema) {
    const props = schema.properties ?? {};
    const req = new Set(schema.required ?? []);
    return Object.entries(props)
        .map(([k, v]) => `${k}${req.has(k) ? " (required)" : " (optional)"}: ${v.description ?? ""}`)
        .join("\n");
}
/** Cursor project rule body — generated from DUO_MCP_TOOL_SCHEMAS (do not hand-edit tool names here). */
function buildDuoProtocolMdc() {
    const toolBlocks = exports.DUO_MCP_TOOL_SCHEMAS.map((t) => {
        const props = t.inputSchema;
        const lines = schemaSummary(props);
        return `### \`${t.name}\`\n${t.description}\n\n${lines || "(no parameters)"}`;
    }).join("\n\n---\n\n");
    return `---
description: Duo Agent — MCP coordination protocol (generated; re-run "Duo: Install Protocol Rules" after extension updates)
alwaysApply: true
---

# Duo Agent protocol

This file is **generated** from the extension's MCP tool catalog. **Re-run "Duo: Install Protocol Rules"** after upgrading Duo Agent so tool names stay exact.

## Session flow

1. Call \`register_agent\` with \`workspace_path\` set to this workspace's absolute path (once per window).
2. Call \`get_my_task\` with your \`agent_id\` (\`A\` or \`B\`) **before** writing code. Poll until \`waiting\` is not true and you receive the full task.
3. Call \`get_mode\` when you need to know if collaboration is \`checkpoint\` or \`auto-run\`.

## Casual user phrases (short chat — no pasted JSON)

If the user says any of these **or clear variants** — **do not** ask them to paste MCP parameters. Run the tools yourself:

- "start using duo agent", "start duo", "start your task using duo agent", "begin my duo task", "pull my duo task", "get my duo task"

**Do this immediately:**

1. \`register_agent\` with \`workspace_path\` = absolute path of the **current workspace root** (this repo folder).
2. \`get_my_task\` with the correct \`agent_id\` (\`A\` or \`B\`).

**Choosing \`agent_id\`:** If \`TASKS.md\` exists at the workspace root, read its first heading: \`# Duo Agent — Agent X Task\` — use that letter \`X\` as \`agent_id\`. If there is no \`TASKS.md\` or you cannot read it, ask **one** short question: *Are you Agent A or B in Duo?*

If \`get_my_task\` returns \`waiting: true\`, say briefly that the **other** Cursor window must call \`get_my_task\` once, then **call \`get_my_task\` again here** after that.

## Contracts and cross-agent alignment

- Before relying on a shared API or data shape, call \`get_contracts\`. Each entry includes \`contentHash\`, \`timestamp\`, \`revision\`, and optional \`service\` / \`title\`.
- If your last \`get_contracts\` was **more than ~30 minutes ago** before you finish or publish a breaking change, call \`get_contracts\` again to avoid stale handshakes.
- To publish or update an agreement, call \`post_contract\` with \`content\`. Set \`service\` (slug, e.g. \`auth-api\`) or a line \`service: my-slug\` at the start of \`content\`. Optional \`title\` helps humans and CI.
- Disk mirror: each \`post_contract\` appends a revision under \`contracts/<service>.md\` in **this** workspace for CI and humans.

## Progress and blocking

- Use \`post_update\` for short progress notes visible in the Duo panel.
- If you cannot proceed until the other side publishes something, send \`post_update\` with a message starting with **BLOCKED:** and the reason.

## Checkpoints (only when \`get_mode\` is \`checkpoint\`)

- Before major or irreversible steps, call \`post_checkpoint\`, then poll \`get_checkpoint_status\` until approved or you receive feedback.

## Status

- Use \`get_status\` for \`sessionReady\`, workspaces, checkpoint state, and contract counts.

---

## MCP tools (generated reference)

${toolBlocks}
`;
}
//# sourceMappingURL=mcpToolCatalog.js.map
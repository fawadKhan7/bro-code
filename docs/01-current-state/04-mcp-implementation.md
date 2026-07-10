# Current MCP Implementation, REST APIs, and Event Streams

> How the Model Context Protocol and the surrounding HTTP surface are implemented today,
> in both generations. Both implementations are **hand-rolled JSON-RPC** (no MCP SDK).

## Generation 1 — Extension server (`src/mcpServer.ts`)

A single Node `http` server on `127.0.0.1:3131` carrying three distinct surfaces:

### 1. MCP over legacy SSE transport

| Endpoint | Method | Purpose |
|---|---|---|
| `/sse` | GET | SSE stream per MCP client. First event announces the message endpoint: `event: endpoint` → `http://127.0.0.1:3131/message?clientId=N` |
| `/message` | POST | JSON-RPC 2.0 requests. Responses are written back **over the SSE stream**, not the POST response (which returns `202`) |

Supported JSON-RPC methods: `initialize` (protocol version `2024-11-05`), `notifications/initialized`,
`tools/list`, `tools/call`. This is the **deprecated HTTP+SSE transport** from the 2024-11-05 MCP
spec — one of the drivers for the transport upgrade
(see [02-architecture-upgrade/03-mcp-transport-upgrade.md](../02-architecture-upgrade/03-mcp-transport-upgrade.md)).

### 2. REST API (used by proxy-mode windows and the control terminal)

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | `{ ok: true, port }` — proxy-mode detection |
| `/api/register` | POST | Register a window as Agent A/B by workspace path (409 when both slots taken) |
| `/api/deregister` | POST | Free a slot (also resets arming) |
| `/api/task` | POST | Set task + mode for an agent |
| `/api/arm` | POST | Arm/disarm agents (`agent_id: A|B|both`); arming requires a task |
| `/api/resolve-checkpoint` | POST | Approve or send feedback on a pending checkpoint |
| `/api/status` | GET | Full session status incl. registrations |

### 3. Panel event stream

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/updates` | GET | SSE stream of `{ type: log|checkpoint|status|registration, data }` events; sends current registration state on connect |

### MCP tools (generation 1)

| Tool | Description |
|---|---|
| `register_agent(workspace_path)` | First caller = A, second = B; idempotent per workspace path |
| `get_my_task(agent_id)` | Returns the task; implements the **arming handshake** — returns `{ waiting: true }` until both agents have called it once |
| `get_mode()` | `auto-run` or `checkpoint` |
| `post_update(agent_id, message)` | Append a progress log entry (pushed live to panels) |
| `get_logs()` | All log entries |
| `post_contract(agent_id, content, title?, service?)` | Store a contract: SHA-256 `contentHash`, per-slug `revision`, **disk mirror** to `contracts/<service>.md` in the poster's workspace |
| `get_contracts()` | All contracts (full list — no delta support in this generation) |
| `post_checkpoint(agent_id, summary, next_step)` | Record a pending checkpoint |
| `get_checkpoint_status(agent_id)` | `pending / approved / feedback (+ feedback text)` |
| `get_status()` | Session status: tasks, workspaces, `armedA/armedB`, `sessionReady`, counts |

## Generation 2 — Conductor server (`conductor/mcp-server/`)

- **Transport:** stdio (newline-delimited JSON-RPC over stdin/stdout). Each editor window spawns
  its own server process from `mcp.json` (`command: node …/mcp-server/dist/index.js`).
- **State:** none in-process — every tool call reads/writes `~/.conductor/session.json`.
- **Tools:** `get_contract(sinceVersion)` (delta reads), `post_update` (structured: type, summary,
  diff, `refs[]` file pointers), `post_checkpoint`, `get_resume_brief`, `get_status`.

Conductor introduced two protocol improvements that generation 1 lacks and the new system keeps:
**`sinceVersion` deltas** (never re-read old updates) and **`refs` file pointers** (no code travels
over MCP — agents get paths and read the files themselves).

## Shared weakness

Both generations hand-implement JSON-RPC dispatch and tool schemas. The new hub uses the official
`@modelcontextprotocol/sdk` with the **streamable HTTP** transport, keeping `/sse` only as a
compatibility fallback — see [02-architecture-upgrade/03-mcp-transport-upgrade.md](../02-architecture-upgrade/03-mcp-transport-upgrade.md).

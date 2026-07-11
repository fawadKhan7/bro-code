# Duo Agent — VS Code Extension

> A VS Code extension that allows two Cursor IDE instances to collaborate on any task together via a shared MCP server.

---

## Project Journey & Decision Log

### Original Idea

The original plan was:

- Use a local WebSocket server as a bridge between two Cursor instances
- One IDE acts as "Host", the other as "Client"
- User types a task → extension auto-splits it into two subtasks → each IDE's agent gets its task **automatically**
- Agent trigger: use VS Code command `workbench.action.chat.open` to inject the task into Cursor's AI chat

### Problem 1 — Agent Trigger Doesn't Work

- `workbench.action.chat.open` is a VS Code Copilot command — not guaranteed to exist in Cursor
- Cursor does **not** expose any API for extensions to programmatically inject messages into the AI agent
- This broke the "fully automatic" core promise of the extension

### Solution: MCP Server as the Bridge

Instead of pushing tasks into Cursor's AI (blocked), let the AI pull its task from a shared **MCP (Model Context Protocol) server**.

- MCP is an official, documented protocol with first-class support in Cursor
- Cursor's AI agents call MCP tools autonomously
- Both Cursor instances connect to the same local MCP server
- Agents coordinate by calling MCP tools — no UI injection needed

### Problem 2 — Auto Task Splitting is Unreliable

- AI guessing which task goes to which agent is unreliable and removes user control
- The split may not match the user's actual project structure

### Solution: Each Window Connects as Its Own Agent

Remove the auto-splitter and the shared task form entirely. Each Cursor window **registers itself** independently:

- First window to connect → **Agent A** (its workspace path is captured automatically)
- Second window to connect → **Agent B** (its workspace path is captured automatically)
- Each window sees only its own task input — no confusion about which box is for which agent

### Problem 3 — Cross-Window Communication

Each Cursor window is a **separate Node.js process** — they don't share memory. The server can only run in one window's process. The other window needs a way to reach it.

### Solution: HTTP REST API + Proxy Mode

The MCP server exposes REST endpoints (`/health`, `/api/register`, `/api/task`, `/api/updates`) in addition to the MCP SSE endpoint. When Window 2 opens:

1. Extension hits `GET /health` on port 3131
2. If it responds → switches to **proxy mode** automatically
3. All operations (connect, set task, approve checkpoint) go via HTTP POST to the running server
4. Window 2 subscribes to `GET /api/updates` (SSE) for real-time log and checkpoint events

### Problem 4 — Panel State Resets on Hide/Show

When the panel is hidden and reshown, VS Code destroys and recreates the webview. `postMessage` calls sent during setup race against JS initialization and are silently dropped, causing the UI to show "Stopped".

### Solution: `retainContextWhenHidden` + Ready Handshake

- `retainContextWhenHidden: true` keeps the webview's JS alive when the panel is hidden
- Webview sends `{ command: "ready" }` when its JS has fully loaded
- Extension waits for this signal before sending any state-sync messages

---

## Current Architecture

```
Window 1 (e.g. backend/)              Window 2 (e.g. frontend/)
┌─────────────────────┐              ┌─────────────────────┐
│  Duo Agent Panel    │              │  Duo Agent Panel    │
│  [HOST]             │              │  [PROXY]            │
│                     │              │                     │
│  Starts HTTP server │              │  Detects server via │
│  on port 3131       │              │  GET /health        │
│                     │              │                     │
│  Connect → Agent A  │              │  Connect → Agent B  │
│  (workspace A path) │              │  (workspace B path) │
│                     │              │                     │
│  Types Agent A task │              │  Types Agent B task │
│  → Set My Task      │              │  → Set My Task      │
│                     │              │  (HTTP POST)        │
│  Live logs (direct) │              │  Live logs (SSE)    │
└─────────────────────┘              └─────────────────────┘
           │                                    │
           └──────── MCP Server :3131 ──────────┘
                           │
              Both Cursor AI agents connect here
              via ~/.cursor/mcp.json config
```

---

## Tech Stack

- **VS Code Extension API (TypeScript)** — sidebar panel, commands, webview
- **HTTP Server (Node.js `http` module)** — MCP SSE transport + REST API for cross-window communication
- **Webview panel** — per-window UI with state machine (disconnected → connected → task set)
- **File system** — `TASKS.md` and `CONTRACTS.md` written to each agent's workspace root

---

## MCP Server

Runs locally on port 3131. Implements two layers:

### MCP Tools (called by AI agents)

| Tool | Input | Description |
| ---- | ----- | ----------- |
| `register_agent` | `workspace_path` | Registers this window as Agent A or B. First to connect = A, second = B. Returns `{ agentId }` |
| `get_my_task` | `agent_id` | Returns `{ description, workspace, context }` for this agent |
| `get_mode` | — | Returns current mode: `auto-run` or `checkpoint` |
| `post_update` | `agent_id`, `message` | Logs progress — appears live in the panel |
| `get_logs` | — | Returns all log entries from both agents |
| `post_contract` | `agent_id`, `content` | Shares an interface, API shape, file format, or any agreement with the other agent |
| `get_contracts` | — | Returns all contracts posted by both agents |
| `post_checkpoint` | `agent_id`, `summary`, `next_step` | Pauses agent and requests user approval (Checkpoint mode) |
| `get_checkpoint_status` | `agent_id` | Returns `{ status: pending\|approved\|feedback, feedback? }` |
| `get_status` | — | Returns full session state — tasks, workspaces, checkpoints, counts |

### REST API (used internally by Window 2 in proxy mode)

| Endpoint | Method | Description |
| -------- | ------ | ----------- |
| `/health` | GET | Health check — returns `{ ok: true }` |
| `/api/register` | POST | Register an agent by workspace path |
| `/api/deregister` | POST | Deregister an agent |
| `/api/task` | POST | Set a task for an agent |
| `/api/resolve-checkpoint` | POST | Approve or give feedback on a checkpoint |
| `/api/status` | GET | Full session status including registrations |
| `/api/updates` | GET | SSE stream — pushes log, checkpoint, registration events to subscriber windows |
| `/sse` | GET | MCP SSE transport (for Cursor AI agents) |
| `/message` | POST | MCP JSON-RPC messages (for Cursor AI agents) |

### Message Protocol

Full JSON-RPC 2.0. Methods supported:
- `initialize` — handshake with Cursor's MCP client
- `tools/list` — returns all tool schemas
- `tools/call` — executes a tool

---

## What a Contract Is

A **contract** is a plain-text message one agent posts so the other can read it. It has no enforced schema — it's whatever the posting agent decides to share. Typically:

- API endpoint definitions (`POST /products → { name, price }`)
- File formats (`products.json: [{ id, name, price, url, scrapedAt }]`)
- Database schemas (table names, column types)
- TypeScript interfaces or function signatures
- Any shared constant (ports, paths, keys)

Contracts solve the **dependency problem** without polling: Agent A posts the contract as soon as the shape is decided (even before implementation). Agent B calls `get_contracts` once when it's ready to integrate — the data is already there.

---

## Panel UI — State Machine

Each window's panel has three states:

### State 1: Disconnected
- Server status indicator (Running / Stopped)
- Slot indicators showing which agent slots are open or taken
- **"Connect as Agent"** button — registers this window, captures workspace path automatically

### State 2: Connected
- Role badge (Agent A or Agent B) + workspace path
- Task input (only for this agent's role)
- Mode selector (Auto-run / Checkpoint)
- **"Set My Task & Get Kickoff Prompt"** button

### State 3: Task Set
- Kickoff prompt card with **Copy** button
- Prompt includes: agent ID, workspace path, step-by-step instructions for calling MCP tools
- Live logs area (updates in real time from both agents)
- Checkpoint review cards (Checkpoint mode only)

---

## Kickoff Prompt

After clicking "Set My Task", the panel generates a ready-to-paste prompt for Cursor AI chat:

```
You are Agent A in a Duo Agent collaboration session.
Your workspace: D:/projects/backend
Another AI agent (Agent B) is working in parallel in a separate Cursor window.

Step 1 — Get your task:
Call the `get_my_task` MCP tool (duo-agent server) with agent_id = "A".

Step 2 — Coordinate with Agent B:
Use `post_contract` to share any interfaces, API shapes, or data formats.
Use `get_contracts` regularly to stay aligned with Agent B.
Use `post_update` to log your progress.

Step 3 — Execute:
Work autonomously until your task is fully complete.
```

---

## Checkpoint Mode

When mode is `checkpoint`, agents pause before major or irreversible actions:

1. Agent calls `post_checkpoint(agent_id, summary, next_step)`
2. MCP server stores the checkpoint
3. Panel shows a review card:
   > **Agent A — Checkpoint**
   > Done: Scraper built and tested locally
   > Next: About to write to the production database
   > `[ Approve & Continue ]` `[ Give Feedback ]`
4. User clicks **Approve** → `get_checkpoint_status` returns `{ status: "approved" }` → agent continues
5. User clicks **Give Feedback** → types feedback → agent reads it via `get_checkpoint_status` and adjusts

---

## File Structure

```
duo-agent/
├── package.json          ← dependencies, scripts (compile, watch, package)
├── tsconfig.json
├── src/
│   ├── extension.ts      ← activation, commands, DuoAgentViewProvider, proxy mode logic
│   ├── mcpServer.ts      ← HTTP server, MCP JSON-RPC, REST API, all tool implementations
│   ├── workspaceSetup.ts ← writes TASKS.md and CONTRACTS.md to agent's workspace
│   └── panel/
│       └── webview.html  ← full sidebar UI with state machine
├── out/                  ← compiled JS (generated by tsc)
├── media/
│   └── icon.svg
└── duo-agent-0.0.4.vsix  ← installable package (built with npm run package)
```

---

## VS Code Commands

| Command | Action |
| ------- | ------ |
| `duo-agent.startServer` | Start MCP server (auto-called on activation) |
| `duo-agent.stopServer` | Stop MCP server (host window only) |
| `duo-agent.openPanel` | Focus the Duo Agent sidebar panel |

- Activation event: `onStartupFinished`
- Server auto-starts on activation — no button click needed on first launch
- `retainContextWhenHidden: true` on the webview provider

---

## User Flow

### One-time setup

1. Install `duo-agent-0.0.4.vsix` in both Cursor windows via `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
2. Add to `~/.cursor/mcp.json`:
   ```json
   "duo-agent": {
     "url": "http://127.0.0.1:3131/sse"
   }
   ```
3. Restart both Cursor windows

### Every session

1. **Window 1** (e.g. backend project) — open Duo Agent panel → server auto-starts → click **Connect as Agent** → becomes Agent A
2. **Window 2** (e.g. frontend project) — open Duo Agent panel → automatically detects running server → click **Connect as Agent** → becomes Agent B
3. **Window 1** — type Agent A's task → click **Set My Task** → copy the kickoff prompt → paste into Cursor AI chat (`Ctrl+L`) → press Enter
4. **Window 2** — type Agent B's task → click **Set My Task** → copy the kickoff prompt → paste into Cursor AI chat → press Enter
5. Both agents call `get_my_task`, begin working, post contracts and updates via MCP
6. Watch live logs in either panel — both windows receive all events in real time
7. In Checkpoint Mode: review and approve at each milestone via the panel

---

## Token Efficiency Notes

- Agents should call `get_contracts` **once** when ready to integrate — not in a polling loop
- Agent B should do all independent work first, and only check contracts when it actually needs them
- Agent A should call `post_contract` as soon as the shape is decided (before implementation is done)
- Use Checkpoint mode for dependent tasks — the agent pauses once and waits for manual approval, no polling
- Kickoff prompts explicitly instruct agents not to poll repeatedly

---

## Important Notes

- The MCP server runs in the **first window that opens the panel** — this is the host window
- All other windows operate in proxy mode — they talk to the host's server via HTTP
- If the host window is closed, the server stops and all other windows lose connection
- Each agent's workspace path is captured automatically from the open folder — agents always know where to work
- `TASKS.md` and `CONTRACTS.md` are written to each agent's own workspace root for persistent context
- The `.vsix` can be rebuilt any time with `npm run package`

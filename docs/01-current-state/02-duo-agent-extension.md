# Duo Agent Extension (Generation 1)

> The current production implementation: a VS Code extension installed in every Cursor window,
> hosting an in-process HTTP server that two Cursor AI agents coordinate through.

## Purpose

Let two Cursor IDE windows — usually opened on **different workspaces** (e.g. frontend + backend) —
collaborate on one goal. Each window's AI agent gets its own task, and the agents share
interfaces ("contracts"), progress logs, and human-approval checkpoints through a local server.

## Architecture

```
Window 1 (backend/)                    Window 2 (frontend/)
┌─────────────────────┐               ┌─────────────────────┐
│  Duo Agent Panel    │               │  Duo Agent Panel    │
│  [HOST]             │               │  [PROXY]            │
│  starts HTTP server │               │  detects server via │
│  on port 3131       │               │  GET /health        │
│  Connect → Agent A  │               │  Connect → Agent B  │
│  live logs (direct) │               │  live logs (SSE)    │
└─────────┬───────────┘               └──────────┬──────────┘
          └────────── MCP Server :3131 ──────────┘
                            │
          Both Cursor AI agents connect via ~/.cursor/mcp.json
```

Key design facts:

- **The server lives inside the extension host process** of whichever window opens the panel
  first ("host window"). Source: [`src/mcpServer.ts`](../../src/mcpServer.ts), instantiated from
  [`src/extension.ts`](../../src/extension.ts).
- Every Cursor window is a separate Node.js process, so the second window cannot share memory
  with the server. It runs in **proxy mode**: it detects the server with `GET /health` and does
  everything over REST + an SSE event stream (`/api/updates`).
- Cursor's AI agents (the actual LLMs) connect separately, as **MCP clients** over SSE
  (`http://127.0.0.1:3131/sse`), configured once in `~/.cursor/mcp.json`.

## Components

| Component | File | Responsibility |
|---|---|---|
| Extension entry | `src/extension.ts` | Activation, commands, webview provider, host-vs-proxy detection, SSE subscription |
| Server | `src/mcpServer.ts` | HTTP server: MCP JSON-RPC over SSE, REST API, session state, all MCP tool implementations |
| Tool catalog | `src/mcpToolCatalog.ts` | JSON schemas for the MCP tools (also used to generate protocol rules files) |
| Contract disk mirror | `src/contractDisk.ts` | SHA-256 content hashing, service slug resolution, prepend-style writes to `contracts/<service>.md` |
| Task file writer | `src/taskFileWriter.ts` | Writes `TASKS.md` into each agent's workspace root |
| Control terminal | `src/duoControlCli.ts` | Interactive terminal (`task A …`, `status`, `watch on/off`, `disarm`, `config`) that drives the server over REST and subscribes to SSE |
| Digest CLI | `src/duoDigestCli.ts` | Generates `duo-digest.md` (path-only repo listing) for agent orientation |
| Panel UI | `src/panel/webview.html` | Sidebar webview with a three-state UI (see below) |

## Session state (in-memory, host process)

Defined in `src/mcpServer.ts` (`ServerState`):

```ts
{
  registrations: { A, B },        // workspace path + connectedAt per slot
  tasks:         { A, B },        // description + generated context per slot
  mode:          "auto-run" | "checkpoint",
  armed:         { A, B },        // true once that agent calls get_my_task from chat
  logs:          LogEntry[],
  contracts:     Contract[],      // content, contentHash, revision, service slug, diskPath
  checkpoints:   { A, B },        // summary, nextStep, status: pending|approved|feedback
  contractRevisionBySlug: {},     // monotonic revision per contract service
}
```

Notable mechanism — **the arming handshake**: after tasks are set, `get_my_task` returns
`{ waiting: true }` until **both** agents have called it at least once. This synchronizes the two
chat sessions so neither agent races ahead before its peer exists. (This survives, generalized,
in the new architecture — see [03-core-concepts/session-lifecycle.md](../03-core-concepts/session-lifecycle.md).)

## Panel UI state machine

1. **Disconnected** — server status, slot indicators, "Connect as Agent" button (captures the
   window's workspace path automatically; first window = A, second = B).
2. **Connected** — role badge, task input for this agent only, mode selector (Auto-run / Checkpoint).
3. **Task set** — generated **kickoff prompt** with a Copy button (user pastes it into Cursor
   chat manually), live logs, checkpoint review cards.

`retainContextWhenHidden: true` plus a `ready` handshake works around VS Code destroying webviews
on hide/show (see the decision log in [`instruction.md`](../../instruction.md)).

## User flow (every session)

1. Window 1: open panel → server auto-starts → Connect as Agent (A).
2. Window 2: open panel → proxy mode auto-detected → Connect as Agent (B).
3. Each window: type this agent's task → Set My Task → **copy kickoff prompt → paste into
   Cursor chat manually** → agent calls `get_my_task` and begins.
4. Watch live logs; in Checkpoint mode, approve/give feedback from the panel or control terminal.

The manual copy-paste in step 3 exists because Cursor exposes **no API for extensions to inject
prompts into its AI chat** — the single constraint that shaped this whole generation. The
extension can get data *out* (via MCP tools the agent calls) but cannot push prompts *in*.

## VS Code integration points

| Item | Value |
|---|---|
| Commands | `duo-agent.startServer`, `duo-agent.stopServer`, `duo-agent.openPanel`, session terminal, "Install Protocol Rules" |
| Activation | `onStartupFinished`; server auto-starts |
| Protocol rules | Command writes `.cursor/rules/duo-protocol.mdc` generated from the live tool catalog |
| Install | `.vsix` via "Extensions: Install from VSIX…" in **both** windows |

## What this generation proved

- MCP is a reliable coordination bus for Cursor agents.
- Contracts + arming + checkpoints are the right coordination primitives.
- The pull model (agent fetches its task via MCP) works around prompt-injection limits.

## What it cannot do

Only Cursor; requires extension install per window; server dies with the host window; manual
copy-paste per session; hard-coded two agents. Full assessment:
[06-strengths-and-weaknesses.md](06-strengths-and-weaknesses.md).

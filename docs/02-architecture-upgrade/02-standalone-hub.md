# Decision: Standalone Hub

> The coordination server moves out of the VS Code extension host and becomes an independent
> local process, spawned and owned by the CLI. It is the single source of truth for a session.

## What changes

| Today | After |
|---|---|
| Server runs inside the extension host of the first Cursor window that opens the panel | Server is its own Node process (`packages/hub`), spawned by `duo start`, killed by `duo stop` |
| Session dies when the host window closes | Session survives any editor/agent restart; state persisted to `~/.duo/session.json` |
| Second window must proxy through REST because processes can't share memory | Nothing proxies — every participant (CLI, agents, dashboard) is a network client of the same hub |
| Conductor variant: N stdio server processes sharing an unlocked JSON file | Exactly one process owns state; the file is a write-through persistence layer, not a coordination channel |

## Why the server moves outside the extension

1. **AI-agnosticism is impossible inside an editor.** An extension host exists only in Cursor.
   Claude Code, `cursor-agent`, and future CLIs have no extension host. The one component every
   agent type *can* reach is a local HTTP server.
2. **Lifecycle independence.** The session must outlive any single participant. Today, closing
   the host window kills everything mid-task. A CLI-owned daemon has exactly one owner with a
   clear lifetime (`start` … `stop`).
3. **It was already 95% standalone.** `src/mcpServer.ts` is plain Node `http` with zero VS Code
   imports — the extraction is a move, not a rewrite. The extension was only ever a *container*
   for it (plus UI).
4. **It removes an entire class of bugs.** Proxy-mode detection, webview lifecycle hacks,
   host-vs-client asymmetry — all of that code exists only because the server lived in a window.
   It is deleted, not ported.

## Why the hub is the source of truth

All session state lives in exactly one place — the hub's memory, write-through persisted:

- **Correctness:** one process mutating state means no lost-update races (Conductor's flaw) and
  a single consistent view for every observer.
- **Token efficiency:** agents don't carry coordination state in their context windows; they ask
  the hub for deltas (`get_board(sinceVersion)`) instead of replaying history
  ([04-strategies-and-design-principles/token-efficiency.md](../04-strategies-and-design-principles/token-efficiency.md)).
- **Recovery:** if an agent crashes, the board, contracts, and checkpoints are intact; the
  replacement agent resumes from a brief, not from scratch
  ([04-strategies-and-design-principles/failure-recovery.md](../04-strategies-and-design-principles/failure-recovery.md)).
- **Observability:** the CLI and dashboard render hub state; they hold none of their own.

## Why agents communicate through the hub (never peer-to-peer)

- **Mediation is the feature.** The hub enforces the rules that make collaboration safe:
  the plan gate, claim validation (workspace ownership), the completion rule (no unfinished
  board items), checkpoint blocking. Direct agent-to-agent chat would bypass every gate.
- **Structured deltas beat conversation.** Contracts and board items are compact, versioned
  facts. Two LLMs talking freely re-send context in both directions and drift; see
  [04-strategies-and-design-principles/token-efficiency.md](../04-strategies-and-design-principles/token-efficiency.md).
- **N-agent scaling.** Hub-mediated is a star topology — adding an agent adds one connection.
  Peer-to-peer is a mesh — N² connections and no arbiter for conflicting claims.

## Hub surfaces

```
Hub (127.0.0.1:3131, single Node process)
├── POST/GET /mcp            ← MCP streamable HTTP (agents)          [primary]
├── GET /sse + POST /message ← MCP legacy SSE (older clients)        [compat]
├── REST /api/*              ← CLI + dashboard control plane
│     /health /api/status /api/board /api/plan/approve
│     /api/checkpoint/resolve /api/feedback /api/stop
├── GET /api/updates         ← SSE event stream (logs, board, checkpoints, status)
└── GET /                    ← dashboard static page                 [phase 4]
```

State model and persistence details:
[04-strategies-and-design-principles/state-management.md](../04-strategies-and-design-principles/state-management.md).
Component deep-dive: [03-core-concepts/hub.md](../03-core-concepts/hub.md).

## Trade-offs accepted

- **A daemon to manage.** The CLI must handle stale hubs, port conflicts, and orphaned processes
  (`duo doctor`, PID file, `/health` probe). Accepted: it's standard daemon hygiene, and far
  cheaper than the editor-lifecycle problems it replaces.
- **Localhost port is a shared resource.** Port 3131 is the default with `--port` override;
  a second concurrent session is out of scope for v1.

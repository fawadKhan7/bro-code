# Concept: Hub

## What it is

The hub is a standalone Node.js process that owns everything shared in a session: the task
board, contracts, checkpoints, logs, agent registrations, and the session phase. It listens on
`127.0.0.1:3131` (configurable) and exposes three surfaces: MCP for agents, REST for control,
SSE for live events — plus the dashboard page.

## Why it exists

Agents run in separate processes (different CLIs, different vendors) and cannot share memory.
They need one mediator that is always reachable, enforces the collaboration rules, and survives
any individual participant dying. Both previous generations lacked this: the extension's server
died with its host window; Conductor had N servers sharing an unlocked file
([01-current-state/06-strengths-and-weaknesses.md](../01-current-state/06-strengths-and-weaknesses.md)).

## How it works

- **Spawned by the CLI** on `duo start` (reused if already healthy — `GET /health`); stopped by
  `duo stop`. PID + port recorded under `~/.duo/`.
- **State in memory, write-through persisted** to `~/.duo/session.json` after every mutation —
  restart-safe, never used as a coordination channel
  ([state-management.md](../04-strategies-and-design-principles/state-management.md)).
- **Enforces the rules**: plan-phase gate, claim validation (workspace ownership), the completion
  rule (no open/claimed items), checkpoint blocking, arming/registration handshakes.
- **Pushes events** (`log`, `board`, `checkpoint`, `status`, `registration`) over `GET
  /api/updates` (SSE) to the CLI's watch mode and the dashboard.
- **Zero LLM calls** — pure logic; merging plan proposals uses title/path similarity, not AI.
- **Owns the agents (v2, phase 6)** — the hub contains a `SessionSupervisor` that launches agents
  via adapters, keeps them alive across planning→execution, pipes their output into hub logs,
  gates on registration, and auto-resumes crashes. Session lifecycle is driven over REST
  (`/api/session/start|stop|resume`), so the CLI, dashboard, and desktop app are all equal clients
  and a session survives the terminal that started it. Setup-support endpoints (`/api/config`,
  `/api/fs/list` home-sandboxed, `/api/runners/detect`) let a GUI do folder/agent/role setup.

### Surfaces

| Surface | Endpoint(s) | Consumers |
|---|---|---|
| MCP streamable HTTP | `POST/GET /mcp` | Agents (primary) |
| MCP legacy SSE | `GET /sse`, `POST /message` | Older MCP clients (compat) |
| REST control | `/health`, `/api/status`, `/api/board`, `/api/plan/approve`, `/api/checkpoint/resolve`, `/api/feedback`, `/api/stop` | CLI, dashboard |
| Event stream | `GET /api/updates` (SSE) | CLI watch, dashboard |
| Dashboard | `GET /` (static page) | Browser |

## How it interacts with other components

- **CLI** ([cli.md](cli.md)) spawns it, controls it over REST, watches it over SSE.
- **Agents** ([agent.md](agent.md)) call its MCP tools ([mcp.md](mcp.md)); they never talk to
  each other directly — the star topology is what makes rules enforceable and N agents cheap.
- **Adapters** ([adapter.md](adapter.md)) point agents at it but are otherwise invisible to it.
- **Dashboard** ([dashboard.md](dashboard.md)) is served by it and renders its state.

## Example

```bash
duo start "Add OAuth"           # CLI spawns hub, launches agents
curl -s localhost:3131/health   # { "ok": true, "port": 3131 }
curl -s localhost:3131/api/status | jq .phase   # "planning"
duo approve                     # CLI → POST /api/plan/approve → held MCP calls resolve
```

Full decision rationale: [02-architecture-upgrade/02-standalone-hub.md](../02-architecture-upgrade/02-standalone-hub.md).

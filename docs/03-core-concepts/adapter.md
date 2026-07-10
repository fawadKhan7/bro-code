# Concept: Adapter

## What it is

An adapter is the per-AI integration module — the *only* place in the codebase that knows how a
specific AI is configured and launched. Four methods: `detect()`, `configure()`, `launch()`,
`stop()`. Three ship in v1: `claude-code`, `cursor-cli`, `cursor-ide`.

## Why it exists

Every AI CLI differs in exactly two ways that matter to us: **where its MCP config lives** and
**how you start it headlessly with a prompt**. Everything else (coordination, state, protocol) is
identical across AIs because it happens over MCP with the hub. Adapters quarantine those two
differences so the rest of the system is AI-agnostic — and so supporting a new AI is one new
file, not a refactor ([adapter-isolation.md](../04-strategies-and-design-principles/adapter-isolation.md)).

## How it works

| Method | claude-code | cursor-cli | cursor-ide |
|---|---|---|---|
| `detect()` | `claude` binary on PATH, version check | `cursor-agent` on PATH | always available (needs only a human) |
| `configure()` | write `.mcp.json` → `http://127.0.0.1:3131/mcp` | write `.cursor/mcp.json` | write `.cursor/mcp.json` |
| `launch()` | spawn `claude -p "<kickoff>" --output-format stream-json` in the workspace | spawn `cursor-agent -p "<kickoff>" --force --output-format stream-json` | copy kickoff to clipboard, print instructions; resolves when hub sees `register_agent` |
| `stop()` | SIGTERM the process | SIGTERM the process | no-op (informational message) |

Common behavior implemented once and shared: piping stream-json output into hub logs, watching
for premature exit (frees that agent's claimed board items), and the **startup self-check** —
if the hub hasn't seen the agent's `register_agent` within a deadline, launch fails loudly with
a per-runner diagnosis instead of hanging.

## How it interacts with other components

- **CLI** calls `detect → configure → launch` per slot on `duo start`; `duo doctor` runs
  `detect()` across all adapters.
- **Hub** never sees adapters — agents arrive as anonymous MCP clients that identify themselves
  via `register_agent`.
- **Kickoff prompts** are built by the shared prompt builder; adapters *deliver* them (argument
  vs. clipboard) and may select prompt variants (e.g. polling instead of held tool calls for
  cursor-cli — see [02-architecture-upgrade/04-adapter-architecture.md](../02-architecture-upgrade/04-adapter-architecture.md)).

## Example: mixed session

```jsonc
{
  "agents": [
    { "id": "A", "workspace": "~/proj/web", "runner": "cursor-ide",  "role": "Frontend" },
    { "id": "B", "workspace": "~/proj/api", "runner": "claude-code", "role": "Backend" }
  ]
}
```

`duo start` → B launches fully automatically; for A the CLI prints *"kickoff copied to
clipboard — paste into Cursor agent chat in ~/proj/web"* and waits for A's registration.
One session, two delivery mechanisms, identical coordination.

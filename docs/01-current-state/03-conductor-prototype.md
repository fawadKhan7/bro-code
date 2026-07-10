# Conductor Prototype (Generation 2)

> The CLI-first prototype in [`conductor/`](../../conductor/). Right UX direction — no extension,
> preset briefs, project scanning — but built on a coordination model (stdio server + shared JSON
> file) that does not survive scaling.

## Purpose

Replace the extension workflow with a single terminal command: the user gives one goal,
Conductor frames it into two role-focused briefs (via static presets — **no API keys, no LLM
calls in the orchestrator**), injects them into each Cursor project as rules files, and
coordinates both agents through MCP tools.

## Architecture

```
conductor CLI ──── writes ────►  ~/.conductor/session.json  ◄──── reads/writes ────┐
     │                                                                             │
     │ injects .cursor/rules/conductor-agent-{a,b}.mdc                             │
     ▼                                                                             │
workspace A, workspace B                                                           │
     │                                                                             │
     ▼                                                                             │
Cursor spawns conductor mcp-server (stdio) per window ─────────────────────────────┘
```

Three packages (npm workspaces):

| Package | Role |
|---|---|
| `conductor/shared` | Types, session file I/O, presets, project scanner, rules injection, resume briefs |
| `conductor/mcp-server` | **Stdio** MCP server — JSON-RPC over stdin/stdout, tools read/write the session file |
| `conductor/cli` | `conductor init / start / status / feedback / stop` |

## The session file is the database

All state lives in `~/.conductor/session.json` (`shared/src/session.ts`):

```jsonc
{
  "active": true,
  "goal": "…", "preset": "frontend-backend",
  "pathA": "…", "pathB": "…",
  "briefA": "…", "briefB": "…",
  "injectedRuleA": "…", "injectedRuleB": "…",
  "contractVersion": 3,          // monotonic; enables sinceVersion deltas
  "updates": [],                 // structured updates with version, refs
  "checkpointA": null, "checkpointB": null,
  "checkpointPhase": "idle | waiting_user | resumed",
  "lastFeedback": null,
  "resumeBriefVersion": 0, "resumeBrief": null
}
```

Every MCP tool call and every CLI command does `loadSession() → mutate → saveSession()` —
a full read-modify-write of the JSON file with **no locking**.

## Flow of `conductor start "goal"`

From `cli/src/commands/start.ts`:

1. Load config (`conductor init` must have registered both workspace paths + preset).
2. `buildBriefs(goal, preset)` — static template expansion, one brief per role
   (see [03-core-concepts/presets.md](../03-core-concepts/presets.md)).
3. `scanProjectMap()` on each workspace — regex-based project map
   (see [03-core-concepts/project-scanner.md](../03-core-concepts/project-scanner.md)).
4. `injectRule()` — writes brief + project map into `.cursor/rules/` in each workspace.
5. Save the session file; print the MCP config snippet for `~/.cursor/mcp.json`.
6. **The user still starts both Cursor agents manually** — Conductor cannot launch them.

## Ideas that carry forward into the new architecture

| Idea | Where it goes |
|---|---|
| CLI-first, zero extension | The `duo` CLI ([02-architecture-upgrade/01-overview.md](../02-architecture-upgrade/01-overview.md)) |
| Static role presets, zero orchestrator LLM | [03-core-concepts/presets.md](../03-core-concepts/presets.md) |
| Project scanner (zero-token orientation) | [03-core-concepts/project-scanner.md](../03-core-concepts/project-scanner.md) |
| `sinceVersion` delta reads | [04-strategies-and-design-principles/token-efficiency.md](../04-strategies-and-design-principles/token-efficiency.md) |
| Resume briefs (condensed context after checkpoints) | [03-core-concepts/resume-system.md](../03-core-concepts/resume-system.md) |
| `refs` (file pointers instead of code over MCP) | [03-core-concepts/contracts.md](../03-core-concepts/contracts.md) |

## Why its coordination model is a dead end

1. **One stdio server instance per editor process.** Each Cursor window spawns its *own*
   `mcp-server` process. There is no single authority — "the server" is N processes that happen
   to share a file.
2. **Shared JSON file with no locking.** Concurrent read-modify-write from multiple processes
   (two MCP servers + the CLI) loses updates under real concurrency. Works in a demo; corrupts
   state under load.
3. **No push channel.** A stdio server can't push events to the CLI or a dashboard; `conductor
   status` polls the file. Live logs, checkpoint notifications, and dashboards all need SSE/HTTP —
   which the extension generation already had.
4. **Still can't launch agents.** It injects rules files but the user must start each Cursor
   agent by hand.

The conclusion that drives the upgrade: **combine Conductor's UX shape (CLI, presets, scan,
deltas, resume) with the extension generation's live HTTP hub (single process, single state,
push events)** — and add adapters so agents are launched automatically.
See [06-strengths-and-weaknesses.md](06-strengths-and-weaknesses.md).

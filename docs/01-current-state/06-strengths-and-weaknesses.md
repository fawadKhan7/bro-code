# Current Strengths and Weaknesses — Why the Architecture Must Evolve

> Honest assessment of both generations. This document is the justification for the upgrade
> specified in [02-architecture-upgrade/](../02-architecture-upgrade/).

## Strengths (what we keep)

### 1. The coordination model is proven
The pull-based model — agents fetch tasks and coordinate by calling MCP tools, rather than
anything pushing prompts into an editor — works reliably in practice and is exactly what makes
the system portable to *any* MCP-capable AI. This was generation 1's key discovery
(see the decision log in [`instruction.md`](../../instruction.md)).

### 2. The contract system
Versioned, hashed, disk-mirrored contracts solve inter-agent dependencies without polling and
leave a git-auditable trail. No redesign needed
([05-coordination-mechanisms.md](05-coordination-mechanisms.md)).

### 3. Agent synchronization (arming handshake)
The "both agents must check in before anyone gets a full task" gate prevents race-ahead problems
and gives the human a clear "session is live" signal.

### 4. Live updates
The extension server already has the right event architecture: one authority process, SSE push
to any number of observers. (Conductor lost this; the upgrade restores it.)

### 5. Existing CLI foundations
`duoControlCli.ts` (interactive session terminal) and Conductor's command set
(init/start/status/feedback/stop) mean the CLI UX has already been designed and used — the
upgrade reuses both.

### 6. Zero-API-key principle
The orchestrator never calls an LLM: presets are templates, the scanner is regex, the hub is pure
logic. Users pay only for the agent subscriptions they already have. This is a hard constraint
carried into the new design.

## Weaknesses (what forces the evolution)

### 1. VS Code / Cursor dependency
The server lives inside a VS Code extension host. Consequences: only Cursor is supported; a
`.vsix` must be installed in every window; the UI is bound to the webview API and its lifecycle
hacks (`retainContextWhenHidden`, ready handshakes).

### 2. Host-window fragility
The server dies when the host window closes — the session, logs, and contracts (in-memory parts)
die with it. Proxy-mode windows just lose connection.

### 3. Manual kickoff copy-paste
Cursor offers no API to inject a prompt into its chat, so every session requires the user to
copy a kickoff prompt and paste it into each window. This was unavoidable in 2024–2025; it is
avoidable now that **Claude Code and Cursor both ship headless CLIs** that accept a prompt as an
argument.

### 4. Multiple MCP server instances + JSON-file coordination (Conductor)
Conductor's stdio design spawns one server per editor window; all of them do unlocked
read-modify-write on `~/.conductor/session.json`. No single source of truth, lost-update races,
and no push channel for live events. Fine for a demo, structurally wrong for the product.

### 5. Lack of centralized orchestration
Neither generation can **launch agents**. Both prepare context (tasks, rules files) and then wait
for the human to start each agent by hand. The orchestrator orchestrates state, not agents.

### 6. Limited agent scalability
`AgentId = "A" | "B"` is baked into types, state shape, REST payloads, tool schemas, and UI in
both generations. Three agents is a rewrite, not a config change.

### 7. Rigid role splitting
Tasks/briefs are fixed at start from a preset (frontend/backend etc.). Real goals ("Add Google
OAuth login") cut across frontend, backend, env vars, DB migrations, and deployment — pieces the
static split silently drops. And role pairs beyond frontend/backend (backend+backend,
mobile+backend) don't fit a preset enum at all.

### 8. Deprecated MCP transport
Generation 1 uses the legacy HTTP+SSE transport (spec 2024-11-05) with hand-rolled JSON-RPC.
The MCP ecosystem has moved to **streamable HTTP**; staying on the old transport risks client
incompatibility precisely when we start targeting multiple AI clients.

## The conclusion

Each generation solved half the problem:

| | Extension (gen 1) | Conductor (gen 2) | New system |
|---|---|---|---|
| Single live server, push events | ✅ | ❌ | ✅ |
| No extension, CLI-first | ❌ | ✅ | ✅ |
| Launches agents automatically | ❌ | ❌ | ✅ (adapters) |
| Any MCP-capable AI | ❌ | ❌ | ✅ (adapters) |
| Flexible work splitting | ❌ | ❌ | ✅ (plan + board) |
| N agents | ❌ | ❌ | ✅ (agent list + board) |

The upgrade merges the two halves and adds the two genuinely new pieces — **adapters** (launch
and configure any AI) and the **plan → approve → execute protocol over a task board** (replace
static splitting). Everything else is extraction and generalization of code that already works.

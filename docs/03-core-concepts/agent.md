# Concept: Agent

## What it is

An agent is one AI coding assistant participating in a session. It is defined by four properties
fixed at `duo init` / `duo start`:

```jsonc
{ "id": "A", "workspace": "~/proj/api", "runner": "claude-code", "role": "Backend" }
```

- **id** — slot identifier (`A`, `B`, … — a list, not an enum; N-agent ready).
- **workspace** — the directory it works in. The hard boundary: an agent writes only here
  ([workspaces.md](workspaces.md)).
- **runner** — which AI executes it: `claude-code`, `cursor-cli`, or `cursor-ide`
  ([adapter.md](adapter.md)).
- **role** — a free-form string ("Backend", "Billing service", "Test writer"). A *bias*, not a
  cage: it seeds `ownerHint` in plans and tie-breaks claims, but the plan decides actual
  ownership ([presets.md](presets.md)).

## Why it exists

The whole project premise: two agents working in parallel — with different specializations,
different workspaces, or just double throughput — finish real goals faster than one, *if* they
can coordinate cheaply. The agent abstraction makes "which AI" a configuration detail so any
MCP-capable AI can fill a slot.

## How it works

An agent's life inside a session:

1. **Launched** by its adapter with a generated kickoff prompt (role, goal, workspace binding,
   project map, protocol instructions).
2. **Registers** — calls `register_agent` so the hub knows it's alive (also the cursor-ide
   adapter's confirmation that the human pasted the kickoff).
3. **Plans** — explores its workspace, calls `post_plan`, blocks on `await_plan_approval`
   ([planning-phase.md](planning-phase.md)).
4. **Executes** — claims board items, works, posts contracts and updates, reads peer contracts
   via deltas, pauses at checkpoints.
5. **Finishes** — completes its claims; the gap-sweep instruction makes it re-read the board and
   the goal before declaring done.

The same OS process spans steps 1–5
([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md)).

## How it interacts with other components

- **Hub** — its only communication channel; everything is an MCP tool call ([mcp.md](mcp.md)).
- **Peer agents** — never directly. Coordination artifacts (board items, contracts, refs) are
  the medium; the hub is the mediator.
- **Adapter** — launches and terminates it; invisible afterwards.
- **Human** — through checkpoints and plan approval, surfaced in the CLI/dashboard.

## Example: what Agent B (Backend, claude-code) actually receives

```
Role: Backend

Shared goal: Add Google OAuth login

Your workspace: /Users/x/proj/api — work only inside it.
You are Agent B. Agent A (Frontend, workspace /Users/x/proj/web) works in parallel.

# Existing Codebase          ← injected project map (regex scan, zero tokens)
src/auth/auth.service.ts  ← exports: AuthService, generateToken
…

Before writing any code: post a work breakdown via post_plan (include env vars,
migrations, deployment changes; leave unclear items unassigned), then call
await_plan_approval and wait.
During execution: claim board items before working on them; post_contract as soon
as an interface shape is decided; post_update at milestones; before declaring done,
re-read the board and the goal and post anything missing.
```

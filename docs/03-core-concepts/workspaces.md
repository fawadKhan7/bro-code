# Concept: Workspaces

## What it is

A workspace is the directory an agent is bound to — registered at `duo init`, launched into by
the adapter, and enforced as that agent's write boundary for the whole session.

## Why it exists

Parallel agents editing the same files is the classic multi-agent disaster (conflicting edits,
clobbered work, unmergeable state). The workspace boundary is the **hard isolation line** that
makes parallelism safe — and it's enforced by something more reliable than prompts: process
placement. Each agent process is *spawned with its workspace as cwd*; its kickoff binds it
("work only inside this folder"); and the hub validates board claims against it.

## How it works

- **Binding:** `duo init` records `{ id, workspace, runner, role }` per slot. Typical setups:
  two repos (frontend + backend), two services in one org, or two packages of a monorepo.
- **Hard vs. soft boundaries:** the workspace is *hard* (claim validation: an item whose `paths`
  fall in workspace A can only be claimed by agent A). The role is *soft* — a bias for planning
  ([presets.md](presets.md)).
- **Monorepo case:** both agents may share one repo root with different sub-paths
  (`apps/web` vs `apps/api`). Claim validation then works on the sub-path prefixes; genuinely
  shared files (root config, shared types package) should surface as explicit board items
  assigned to exactly one agent during plan approval.
- **What the CLI writes into a workspace:** MCP config (`.mcp.json` / `.cursor/mcp.json`),
  optional rules files, `TASKS.md` (session context, survives restarts), and agents' own
  `contracts/<service>.md` mirrors. All session artifacts are plain files — inspectable,
  git-visible, removable by `duo stop --clean`.

## How it interacts with other components

- **Adapters** ([adapter.md](adapter.md)) spawn the agent process in the workspace and write
  config there.
- **Task board** ([task-board.md](task-board.md)) claim validation uses workspace paths.
- **Project scanner** ([project-scanner.md](project-scanner.md)) scans exactly one workspace per
  agent.
- **Contracts** disk-mirror into the *poster's* workspace ([contracts.md](contracts.md)).

## Example

```jsonc
// Two services, both backend — roles are free-form; workspaces do the isolation
{
  "agents": [
    { "id": "A", "workspace": "~/work/svc-users",   "runner": "claude-code", "role": "Users service" },
    { "id": "B", "workspace": "~/work/svc-billing", "runner": "claude-code", "role": "Billing service" }
  ]
}
```

Agent A physically cannot claim `svc-billing/src/invoice.ts` work — the hub rejects the claim;
the agents integrate through contracts (API/event shapes) instead of shared files.

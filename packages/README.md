# Duo — multi-agent AI collaboration

Two (later N) AI coding agents work on one goal in parallel, coordinated through a local MCP
hub, driven by a single CLI. Zero API keys — agents run on your existing subscriptions; the
orchestrator never calls an LLM.

> Full design blueprint: [`../docs/`](../docs/). This README is the quickstart for the
> implementation in `packages/`.

## Status

| Phase | State |
|---|---|
| 1 — Standalone hub + protocol (fake-agent tested) | ✅ done |
| 2 — CLI + Claude Code adapter (claude↔claude) | ✅ done |
| 3 — Cursor adapters (mixed sessions) | ⏳ next |
| 4 — Dashboard + npm packaging | ⏳ |

## Packages

```
shared/     types, presets, project scanner, contract disk mirror, resume briefs, prompt builder, config
hub/        standalone coordination server — MCP (streamable HTTP + legacy SSE), REST, SSE events, state
adapters/   per-runner launch/config isolation (claude-code today; cursor-cli/ide in phase 3)
cli/        the `duo` command
```

## Install (dev)

```bash
cd packages
npm install
npm run build
node cli/dist/index.js --help      # or: npm link the cli package to get `duo`
```

Requires Node 20+. For claude↔claude sessions, install
[Claude Code](https://claude.com/claude-code) and confirm with `duo doctor`.

## Quickstart — claude ↔ claude

```bash
# 1. Configure two agents (workspaces, runners, roles). Writes ~/.duo/config.json
duo init

# 2. Start a session. Spawns the hub, launches both Claude Code agents, and they begin planning.
duo start "Add Google OAuth login"

# 3. Review the plan the agents proposed, then approve (assigning any unassigned items).
duo plan
duo approve --assign t5=B

# 4. Watch them execute.
duo status --watch

# 5. When done, archive and shut down.
duo stop
```

For a task whose split is obvious, skip planning: `duo start "fix the login typo" --no-plan`.
For milestone approvals, run in checkpoint mode: `duo start "…" --mode checkpoint` and resolve
pauses with `duo approve --agent B` / `duo feedback "use httpOnly cookies" --agent B`.

## Commands

| Command | Purpose |
|---|---|
| `duo init` | Configure agents (interactive) |
| `duo start "<goal>" [--no-plan] [--mode checkpoint\|auto-run]` | Launch a session |
| `duo plan` | Review the proposed board |
| `duo approve [--assign tN=agent,…] [--out-of-scope tN,…] [--agent <id>]` | Approve a plan or a checkpoint |
| `duo feedback "<msg>" [--agent <id>]` | Revise a plan / steer a checkpoint |
| `duo status [--watch]` · `duo board` | Inspect the session |
| `duo out-of-scope tN,…` | Mark items out of scope (human-only) |
| `duo resume <agent>` | Relaunch a crashed agent from its resume brief |
| `duo stop [--clean]` | Archive the session, stop the hub |
| `duo doctor` | Diagnose runners, hub health, config |

## How work is divided

You give one goal. The agents — which have the codebases open — propose a task breakdown
(`post_plan`), the hub merges the proposals into one board, and you approve it (assigning any
cross-cutting items like env vars or migrations). Then agents claim and complete board items,
sharing interfaces through versioned contracts. The session only finishes when every board item
is done or you mark it out of scope — so cross-cutting work can't be silently dropped.
See [`../docs/03-core-concepts/planning-phase.md`](../docs/03-core-concepts/planning-phase.md).

## Testing

```bash
npm test          # all packages: shared, adapters, hub, cli — tokenless, ~5s
```

The protocol is exercised by **fake agents** (scripted MCP clients) — no AI tokens, deterministic,
runs every commit. Prompt text is pinned by golden files (`shared/test/goldens/`); update
intentionally with `UPDATE_GOLDENS=1`. A real claude↔claude smoke run is opt-in and requires
Claude Code installed (it spends tokens) — see
[`../docs/04-strategies-and-design-principles/testing-strategy.md`](../docs/04-strategies-and-design-principles/testing-strategy.md).

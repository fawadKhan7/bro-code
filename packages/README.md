# BroCode — multi-agent AI collaboration

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
| 3 — Cursor adapters (mixed sessions) | ✅ done |
| 4 — Dashboard + npm packaging | ◐ dashboard done; publish configured, not released |

## Dashboard

The hub serves a live dashboard at **`http://localhost:3131`** — session header, task board,
contracts, activity stream, and review cards for plan approval (with per-item assignment) and
checkpoints. It's a pure client of the same REST + SSE endpoints the CLI uses (zero private
endpoints), auto-reconnects on hub restart/sleep, and every action has a CLI equivalent. Open it
in any browser while a session runs.

More docs: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) · [MIGRATION.md](MIGRATION.md) ·
[PUBLISHING.md](PUBLISHING.md) · [REAL-RUNS.md](REAL-RUNS.md)

## Packages

```
shared/     types, presets, project scanner, contract disk mirror, resume briefs, prompt builder, config
hub/        standalone coordination server — MCP + REST + SSE + hub-owned sessions + dashboard
adapters/   per-runner launch/config isolation (claude-code, cursor-cli, cursor-ide)
cli/        the `duo` command
app/        Electron desktop app (setup wizard, native folder picker, OS notifications)
```

## Two ways to use it

- **Terminal**: `duo init` → `duo start "goal"` → `duo plan`/`duo approve` (or the dashboard at
  `http://localhost:3131`). See below.
- **Desktop app** (zero terminal): `cd packages && npm install && npm run build:app && cd app && npm start`.
  A native window opens on a **setup wizard** — pick folders with the OS dialog, choose runners,
  start a session, approve from OS notifications. See [app/README.md](app/README.md).

## Runners

Each agent slot is backed by a **runner**, chosen per slot at `duo init` — mix them freely.

| Runner | How the agent starts | When to use |
|---|---|---|
| `claude-code` | `claude -p` spawned automatically | Most reliable headless CLI |
| `cursor-cli` | `cursor-agent -p --force --approve-mcps --trust` spawned automatically | Fully automatic Cursor |
| `cursor-ide` | Kickoff copied to your clipboard — you paste into Cursor's agent chat once | GUI preference, or if `cursor-agent` misbehaves |

If `cursor-agent`'s MCP fails to attach (a known print-mode quirk — see
`adapters/src/cursor-spike-notes.md`), `duo doctor` catches it before the session and you switch
that one slot to `cursor-ide` in config — nothing else changes.

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

## Quickstart — mixed session (cursor ↔ claude)

Runner choice is per slot, so cursor↔claude, claude↔cursor, and cursor↔cursor are just config.
At `duo init`, set Agent A's runner to `cursor-cli` (or `cursor-ide`) and Agent B's to
`claude-code` — then the flow is identical:

```bash
duo doctor                          # confirm both runners + MCP attachment before you start
duo start "Add Google OAuth login"  # cursor-cli launches automatically; a cursor-ide slot
                                    #   copies its kickoff to your clipboard to paste once
duo plan && duo approve --assign t5=B
duo status --watch
```

The hub is runner-agnostic — it sees every agent as an anonymous MCP client, so coordination,
contracts, checkpoints, and the task board behave the same in any combination.

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

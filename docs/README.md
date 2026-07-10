# Project Documentation — Duo (working title)

> Multi-agent AI collaboration: two (later N) coding agents — Cursor, Claude Code, or a mix —
> work on one goal in parallel, coordinated through a local MCP hub, controlled from a single CLI.

This directory is the **technical blueprint** of the project. It was written *before* the
implementation of the new architecture, and it serves three purposes:

1. **Record what exists today** — the Duo Agent VS Code extension and the Conductor CLI prototype.
2. **Specify what we are building** — the standalone hub + adapter architecture.
3. **Explain why** — every major decision, strategy, and trade-off is documented so future
   contributors don't have to reverse-engineer intent from code.

## Project vision

Today, the project lets two Cursor IDE windows collaborate through a shared MCP server, but it
requires a VS Code extension, manual copy-pasting of kickoff prompts, and works only with Cursor.

The upgrade turns it into a **single CLI tool** (`duo`) that:

- Works with **any MCP-capable AI agent** — Claude Code, Cursor CLI (`cursor-agent`), Cursor IDE,
  and future providers — in any combination (cursor↔cursor, cursor↔claude, claude↔claude, …).
- **Launches agents automatically** where a headless CLI exists — no copy-paste.
- Coordinates work through a **shared task board** that agents plan, claim, and complete —
  instead of a rigid two-task split.
- Keeps a **human approval checkpoint** after planning and at milestones.
- Requires **zero API keys** — agents run on the user's existing subscriptions; the orchestrator
  itself never calls an LLM.
- Installs with `npm i -g`, runs on macOS and Linux, and needs no editor extension.

## How the documentation is organized

| Folder | Contents |
|---|---|
| [01-current-state/](01-current-state/) | The system exactly as it exists today: extension, prototype, strengths, weaknesses |
| [02-architecture-upgrade/](02-architecture-upgrade/) | The target architecture and every major architectural decision |
| [03-core-concepts/](03-core-concepts/) | One document per concept (hub, adapter, task board, contracts, …) |
| [04-strategies-and-design-principles/](04-strategies-and-design-principles/) | Engineering strategies: token efficiency, testing, failure recovery, … |
| [05-implementation-plan/](05-implementation-plan/) | One document per implementation phase, with acceptance criteria |

## Recommended reading order

**New contributor (full picture):**

1. This README
2. [01-current-state/06-strengths-and-weaknesses.md](01-current-state/06-strengths-and-weaknesses.md) — why the current system must evolve
3. [02-architecture-upgrade/01-overview.md](02-architecture-upgrade/01-overview.md) — the target architecture
4. [03-core-concepts/session-lifecycle.md](03-core-concepts/session-lifecycle.md) — how a session flows end to end
5. [05-implementation-plan/00-roadmap.md](05-implementation-plan/00-roadmap.md) — how we get there

**Implementing a phase:** read that phase's document in `05-implementation-plan/`, then follow its
links into `02-architecture-upgrade/` and `03-core-concepts/` for the components it touches.

**Understanding a single component:** go straight to its file in `03-core-concepts/` — every
concept document is self-contained and links to its neighbors.

## Terminology used throughout

| Term | Meaning |
|---|---|
| **Hub** | The standalone local server: MCP endpoint + REST API + session state. The single source of truth. |
| **Agent** | One AI coding agent (Claude Code, Cursor, …) bound to one workspace and one role. |
| **Adapter** | The per-AI integration layer that configures and launches an agent. |
| **Runner** | The concrete AI backing an agent slot: `claude-code`, `cursor-cli`, or `cursor-ide`. |
| **Task board** | The shared, hub-owned list of work items agents plan, claim, and complete. |
| **Contract** | A versioned message one agent posts so others can integrate (API shapes, schemas, formats). |
| **Checkpoint** | A pause point where an agent waits for human approval or feedback. |
| **Kickoff prompt** | The generated per-agent prompt that starts a session (role, goal, workspace, protocol). |
| **Fake agent** | A scripted MCP client used to test the hub without spending AI tokens. |

## Status

- **Current code**: `src/` (Duo Agent extension, working) and `conductor/` (CLI prototype, working) —
  both documented in `01-current-state/`, both kept as reference until the new system reaches parity.
- **New system**: not yet implemented. `05-implementation-plan/` defines the build order.

`duo` is a working name; the final npm package name is decided at publish time
(see [05-implementation-plan/phase-04-dashboard-and-packaging.md](05-implementation-plan/phase-04-dashboard-and-packaging.md)).

# Migration — from the Duo Agent extension / Conductor

The new `duo` CLI replaces both earlier generations (now archived under `legacy/`). If you used
either, here's what maps to what.

## From the Duo Agent VS Code/Cursor extension

| Old (extension) | New (`duo`) |
|---|---|
| Install `.vsix` in every Cursor window | `npm i -g` once (no editor extension) |
| Server runs inside the host window | Standalone hub, spawned by `duo start`, survives editor restarts |
| Add `~/.cursor/mcp.json` by hand | `duo start` writes project-scoped `.cursor/mcp.json` / `.mcp.json` per workspace |
| Panel: Connect / Set task / copy kickoff / paste into chat | `duo init` once, then `duo start "<goal>"` launches agents automatically (cursor-cli/claude-code) or copies the kickoff for you (cursor-ide) |
| Two fixed tasks (`taskA`/`taskB`) | Task **board**: agents plan, you approve, they claim/complete |
| Sidebar panel for logs/checkpoints | Localhost **dashboard** (`http://localhost:3131`) or `duo status --watch` |
| `get_my_task` arming handshake | Registration handshake (`register_agent`), generalized to N agents |
| Contracts + `contracts/<service>.md` | Unchanged — same disk mirror, now with `since_version` deltas |

The proven pieces (contracts, checkpoints, the arming/registration handshake, disk mirrors) carry
over; what disappears is the extension itself, proxy-mode window detection, and manual copy-paste
(except the deliberate `cursor-ide` fallback).

## From Conductor

| Old (Conductor) | New (`duo`) |
|---|---|
| `conductor init` / `start` / `status` / `feedback` / `stop` | `duo init` / `start` / `status` / `feedback` / `stop` (+ `plan`, `approve`, `board`, `resume`, `doctor`) |
| Preset briefs, project scan, resume briefs | Kept — same presets, scanner, resume system (now in `@duo/shared`) |
| Stdio MCP server per editor + shared `~/.conductor/session.json` | One HTTP hub, single source of truth (no file-based coordination races) |
| Injects `.cursor/rules`; you start agents manually | Adapters launch agents automatically; kickoff carries the brief + project map |
| `get_contract(sinceVersion)` deltas | Kept for both board and contracts |

Presets are now a **bias**, not the final split — agents propose the work breakdown in a planning
phase and you approve it, so cross-cutting work (env, migrations, deploy) stops falling through
the frontend/backend crack.

## First run

```bash
duo init                       # workspaces, runners, roles
duo start "<your goal>"        # or --no-plan for an obvious split
duo doctor                     # if anything looks off
```

See [README.md](README.md) for full quickstarts and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

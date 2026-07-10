# Concept: CLI (`duo`)

## What it is

The single user-facing entry point: a Node CLI (installed via `npm i -g`) that configures
sessions, spawns the hub, launches agents through adapters, and surfaces every human decision
(plan approval, checkpoints, feedback). Successor to both the extension's panel/control-terminal
and Conductor's command set.

## Why it exists

The product promise is "one goal in, coordinated agents out, no editor plumbing." Something has
to own orchestration — configuration, process lifecycles, kickoff generation, human gates — and
a CLI is the cheapest, most scriptable, most editor-agnostic place for it.

## Command set (v1)

| Command | What it does |
|---|---|
| `duo init` | Interactive setup: workspaces, runner + role per slot, preset, mode. Writes `~/.duo/config.json` |
| `duo start "<goal>" [--preset p] [--no-plan] [--mode checkpoint\|auto-run]` | Scan → spawn hub → write MCP configs → build kickoffs → launch agents |
| `duo start --agent-a "…" --agent-b "…"` | Explicit per-agent briefs, bypassing presets |
| `duo plan` | Render the merged proposed board (planning phase) |
| `duo approve [--edit] [--assign tN=A] [--agent X]` | Approve plan, or a pending checkpoint |
| `duo feedback "…" [--agent X]` | Feedback on plan or checkpoint |
| `duo status [--watch]` | Session snapshot; `--watch` = live SSE-fed board/log view |
| `duo logs [--follow]` | Agent update stream |
| `duo resume <agent>` | Relaunch a crashed agent with its resume brief |
| `duo stop [--clean]` | Terminate agents, archive session, stop hub; `--clean` removes written workspace files |
| `duo doctor` | Environment diagnosis: agent CLIs present, versions, hub health, port conflicts, MCP reachability |

## How it works

- **Thin over REST.** Every command except `init`/`start` is a small HTTP client of the hub —
  the CLI holds no session state. This is why the dashboard can offer the same actions with no
  extra hub code.
- **`start` is the orchestrator**: config load → scanner → hub spawn/reuse (`/health` probe,
  PID file) → `adapter.configure()` per slot → prompt builder (brief + binding + map + protocol)
  → `adapter.launch()` → registration handshake gate → hand off to `status --watch`.
- **Failure-loud**: registration timeouts, missing binaries (`detect()`), port conflicts, and
  stale hubs produce specific diagnoses (and `duo doctor` for the rest), never silent hangs.

## How it interacts with other components

- **Hub** ([hub.md](hub.md)): spawns, probes, controls, watches.
- **Adapters** ([adapter.md](adapter.md)): the only component that invokes them.
- **Dashboard** ([dashboard.md](dashboard.md)): equal peer on the same control API.

## Example: the two-command happy path

```bash
$ duo init          # once: web+cursor-cli / api+claude-code, preset frontend-backend
$ duo start "Add Google OAuth login"
  … planning … (auto-notified) → duo plan → duo approve
  … status --watch until done
```

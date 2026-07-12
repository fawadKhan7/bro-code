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

- **Thin over REST.** Every command except `init` is a small HTTP client of the hub — the CLI
  holds no session state and (since phase 6) no agent processes. This is why the dashboard and
  desktop app offer the same actions with no extra hub code.
- **`start` (v2, phase 6)** ensures the hub is up (`/health` probe, PID file), then POSTs
  `/api/session/start` — the **hub** does scan → configure → launch → registration gate. The CLI
  just watches status (surfacing `launchError` loudly) until `done`. Killing the `duo start`
  terminal detaches; the session keeps running in the hub daemon and `duo status` reattaches.
- **`duo` with no args** ensures the hub and opens the dashboard — the one command a
  non-terminal user needs.
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

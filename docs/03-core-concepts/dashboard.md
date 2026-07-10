# Concept: Dashboard

## What it is

A single static web page served by the hub at `http://localhost:3131` — live logs, the task
board, contract list, checkpoint review cards with approve/feedback buttons, and session status.
No build framework requirement, no separate server, no install.

## Why it exists

The CLI is fully sufficient to operate the system, but two things are genuinely better in a
browser: **watching two agents' interleaved activity** over a long run, and **reviewing a plan
or checkpoint** with formatting and one-click actions. The dashboard is the successor to the
extension's webview panel — the same job, minus the editor.

It is also the explicit answer to "should we build a desktop app?" — no, for now. The localhost
page delivers the visual experience at a fraction of the cost, works identically on macOS and
Linux, and if a native shell is ever justified, it wraps this same page (Tauri) without rework.
Decision detail:
[extension-vs-cli-decision.md](../04-strategies-and-design-principles/extension-vs-cli-decision.md).

## How it works

- **Served by the hub** (`GET /`) as static HTML/JS/CSS — no separate process, no port, no CORS.
- **Reads** initial state from the REST API (`/api/status`, `/api/board`), then subscribes to
  `GET /api/updates` (SSE) for live events — the same surfaces the CLI uses; the dashboard has
  zero private endpoints, so anything it can do, the CLI can do.
- **Writes** through the same REST control endpoints: approve plan, resolve checkpoint, send
  feedback, mark items out-of-scope.
- **Reuses** the extension's `webview.html` structure (state machine UI, log stream, checkpoint
  cards) — ported from webview message-passing to fetch + EventSource.

## What it shows

| Panel | Content |
|---|---|
| Session header | Goal, phase, mode, agents (runner badges, registration state) |
| Task board | Items with status/claimant, grouped by agent; unassigned highlighted |
| Live activity | Interleaved `post_update` log from all agents, timestamped |
| Contracts | Slug list with revisions; click → content + refs |
| Review cards | Pending plan approval / checkpoints with Approve · Feedback buttons |

## How it interacts with other components

- **Hub** serves it and feeds it (REST + SSE). It holds no state of its own — refresh-safe.
- **CLI** and dashboard are equal peers on the same control API; approving from either resolves
  the same held MCP call.
- **Built in phase 4** — deliberately last, because the CLI covers every function until then
  ([05-implementation-plan/phase-04-dashboard-and-packaging.md](../05-implementation-plan/phase-04-dashboard-and-packaging.md)).

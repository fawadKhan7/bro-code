# Phase 6 — Hub-Owned Sessions (the GUI prerequisite)

> The one real architecture change in v2: agent processes move from the CLI's ownership into the
> hub's. After this phase, *any* client — CLI, browser, desktop app — can drive the full session
> lifecycle over REST.

## Goal

`POST /api/session/start` launches agents; `POST /api/session/stop` stops them; the hub owns
adapter handles, exit-watching, and auto-resume. The CLI becomes a thin client of these endpoints
(no behavior change for CLI users), and a GUI can finally do everything the CLI does.

## Why this phase exists

In v1, `duo start` (the CLI process) launches agents via adapters and holds their process
handles — so the session dies with that terminal, and no GUI can start sessions (a browser can't
spawn processes). User feedback (2026-07) made a GUI the priority; this is the load-bearing
change that enables it. It also fixes a real v1 wart independently: closing the `duo start`
terminal currently orphans the session's process supervision.

## Scope

**In:** move `SessionRun` (launch, registration gate, exit-watch, auto-resume, log piping) from
`packages/cli` into `packages/hub`; new REST endpoints; hub "idle mode"; CLI rewired as client;
setup-support endpoints for GUIs (`/api/fs/list`, `/api/runners/detect`, config read/write).
**Out:** all UI (dashboard wizard ships with the desktop app, phase 7).

## Architecture changes

```
v1:  duo CLI ──spawns hub──┐            v2:  duo CLI ────REST────┐
     duo CLI ──spawns A,B  │                 desktop app ──REST──┤
     duo CLI ──REST──► Hub ┘                                     ▼
                                             Hub (daemon) ──spawns & owns A,B
```

- **Hub gains a `SessionSupervisor`** (the moved `SessionRun`): adapter resolution, kickoff
  assembly (prompt builder + scanner move usage server-side), launch, registration gate,
  premature-exit → claim release → resume-from-brief, output piping into hub logs.
- **Hub idle mode**: the hub runs without a session (it already does — `phase: init`); `duo`
  with no args starts it and opens the dashboard.
- **New REST** (all localhost-only, same zero-private-endpoints rule):
  - `POST /api/session/start` `{ goal, plan, mode }` — uses stored config
  - `POST /api/session/stop`, `POST /api/session/resume` `{ agent_id }`
  - `GET/PUT /api/config` — the `duo init` data, GUI-editable
  - `GET /api/fs/list?path=…` — directory listing for folder pickers, **sandboxed to $HOME**
  - `GET /api/runners/detect` — adapter `detect()` results for wizard status chips
- **Dependency direction flips**: `@duo/hub` now depends on `@duo/adapters` (+ prompt builder
  from `@duo/shared`). The CLI keeps only rendering + REST calls. Adapters stay a separate
  package (isolation rules unchanged).

## Security note

Launching processes via HTTP raises the stakes of the local API: bind stays `127.0.0.1`, `/api/fs`
is sandboxed to the home directory and rejects traversal, and start/stop endpoints validate
against the stored config (no arbitrary command/workspace injection via request bodies).

## Implementation steps

1. Move `SessionRun` → `packages/hub/src/supervisor.ts`; port its orchestration tests (scripted
   adapters) to run against the hub in-process.
2. New endpoints + validation; `duo` (no args) = ensure hub + open browser.
3. Rewire CLI commands (`start`, `stop`, `resume`) to the endpoints; delete CLI-side process
   handling; keep `--watch` UX identical.
4. Crash semantics: hub restart with live agent processes → supervisor rebuilds what it can
   (registration re-confirmation), documents what it can't (orphaned processes are killed on
   next start; recorded limitation).
5. Fake-agent suite: full lifecycle driven **only over REST** (start → plan → approve → done →
   stop), fs-listing sandbox tests, config round-trip.

## Risks

| Risk | Mitigation |
|---|---|
| Hub crash now kills session supervision too | Write-through persistence already covers state; supervisor rebuild on boot; `duo doctor` reports orphaned agent processes |
| Odd Node child-process behavior from a long-lived daemon vs a foreground CLI | Same spawn code, moved — plus a real-run validation before phase 7 builds on it |
| Blast-radius of a localhost HTTP API that can spawn processes | Config-validated inputs, home-sandboxed fs listing, 127.0.0.1 bind (documented in [state-management.md](../04-strategies-and-design-principles/state-management.md)) |

## Acceptance criteria

1. Full session lifecycle driven purely over REST (fake agents, CI).
2. `duo start` behaves exactly as v1 for a CLI user (same output, same watch), but killing that
   terminal no longer kills session supervision — agents keep running; `duo status` reattaches.
3. A live claude↔cursor run started via `curl` against `/api/session/start` reaches `done`.

## Definition of Done

Tokenless CI green; one real run recorded; [hub.md](../03-core-concepts/hub.md),
[cli.md](../03-core-concepts/cli.md), [adapter.md](../03-core-concepts/adapter.md) and the
architecture overview updated for the moved boundary.

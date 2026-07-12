# Phase 7 — Desktop App (macOS + Linux)

> The v2 headline: a installable desktop application. Users who never touch a terminal set up
> folders, agents, and roles visually, start sessions, and approve plans/checkpoints from a
> native window with OS notifications.

## Goal

Download → open → wizard → running session, with zero terminal use. The app is a native shell
around the same UI and REST surface as the browser dashboard — one UI codebase, three clients
(CLI, browser, app), all equal peers on the hub's API.

## Decision: Electron (not Tauri)

The v1 decision record guessed "Tauri if ever". With the implementation in hand, **Electron wins
for this codebase**:

| Factor | Electron | Tauri |
|---|---|---|
| Our hub is a **Node library** | `import { Hub }` — runs in the main process; no ports guessing, no sidecar | Node must ship as a sidecar binary (pkg/bun compile) + Rust glue |
| Languages | TypeScript only (whole repo stays one language) | + Rust toolchain |
| Native folder picker, notifications, tray | First-class | First-class |
| Packaging macOS+Linux | Mature (electron-builder: dmg, AppImage/deb) | Mature |
| Binary size / RAM | Heavy (~150MB+) | Small |

We pay Electron's footprint to avoid a sidecar architecture and a second language. Revisit
Tauri only if distribution size becomes a real complaint. This supersedes the packaging note in
[extension-vs-cli-decision.md](../04-strategies-and-design-principles/extension-vs-cli-decision.md).

## Architecture

```
┌─ Electron app ────────────────────────────────────────────┐
│ main process:                                             │
│   • runs Hub in-process (import @duo/hub) — idle mode     │
│   • native dialogs (folder picker), notifications, tray   │
│   • detects an already-running external hub → attaches    │
│     instead of double-starting (CLI/app coexistence)      │
│ renderer:                                                 │
│   • the SAME UI as the browser dashboard (shared source,  │
│     packages/ui) — talks to the hub via REST/SSE like     │
│     any other client + a thin preload bridge for native   │
│     bits (pick-folder, notify)                            │
└───────────────────────────────────────────────────────────┘
```

- **`packages/ui`**: the dashboard page graduates from `hub/dashboard/index.html` into a shared
  package; hub serves it (browser) and Electron loads it (renderer). One codebase — a fix in an
  approval card lands in both.
- **Native-vs-web capability bridge**: the UI asks a tiny injected API for `pickFolder()`;
  in the browser it falls back to the `/api/fs/list` picker (phase 6), in the app it gets the
  real OS dialog.
- **Coexistence rule**: one hub per machine stays true. App boots → probes the configured port →
  attaches if healthy, else starts its own in-process hub. `duo` CLI keeps working against
  either.

## The app's screens (feature list frozen — scope-creep guard)

1. **Setup wizard**: folder pickers (native dialog) → runner cards with live detect ✓/✗ and
   install hints → role entry with preset chips → saved to the same `~/.duo/config.json`.
2. **Session home**: goal input, plain-language mode toggle (auto-run vs checkpoint), Start/Stop.
3. **Live session**: the phase-5 board / contracts / activity / review cards.
4. **Approvals via OS notification**: plan posted or checkpoint pending → native notification →
   click focuses the review card.
5. **Tray/menu-bar item**: session phase at a glance; open window; stop session.

## Implementation steps

1. Extract `packages/ui` from the dashboard; hub serves it unchanged (regression: phase-4 tests).
2. Electron scaffold (`packages/app`): main process hub lifecycle (attach-or-start), preload
   bridge, window/tray/notifications.
3. Wizard screens against `/api/config`, `/api/runners/detect`, native `pickFolder()`.
4. Session home + notifications wired to SSE events (`plan`, `checkpoint`, `phase`).
5. Packaging: electron-builder → dmg (macOS, signed/notarized when certs exist) + AppImage/deb
   (Linux); app version pinned to workspace version.
6. First-run UX audit: every failure the CLI reports (`doctor` catalog) has an in-app rendering
   with its fix.

## Dependencies

Phases 5 (cards the app renders) and 6 (REST lifecycle the app drives) complete.

## Risks

| Risk | Mitigation |
|---|---|
| Two hubs (app + CLI) fighting over the port | Attach-or-start probe + the existing PID/health machinery; `duo doctor` names the owner |
| Unsigned-build friction on macOS | Document the right-click-open path for dev builds; signing/notarization once certs exist |
| UI drift between browser and app | Structural: one `packages/ui` source, no forks |
| Electron footprint complaints | Accepted trade-off, recorded above; Tauri path documented as the escape hatch |

## Acceptance criteria

1. A newcomer on a clean Mac/Linux machine, given only the app installer: install → wizard →
   mixed cursor↔claude session → approve plan + one checkpoint from the app (incl. one via
   clicking an OS notification) → `done`. **No terminal at any point.**
2. CLI and app used interchangeably against the same live session (parity audit — every app
   action has a CLI/REST equivalent).
3. Browser dashboard still fully works (served by the hub from the same `packages/ui`).

## Definition of Done

Installers built for macOS + Linux and smoke-tested on clean machines; acceptance run recorded;
[dashboard.md](../03-core-concepts/dashboard.md) rewritten as the "UI" concept (browser + app);
the roadmap and decision record updated — the blueprint ends the phase true.

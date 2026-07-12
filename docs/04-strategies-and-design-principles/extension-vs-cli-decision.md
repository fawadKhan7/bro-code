# Decision Record: Extension vs. CLI vs. Desktop App

> Why the delivery model is a CLI + localhost dashboard — not a VS Code extension (the past)
> and not a native desktop application (the considered alternative).

## The three candidates

| | Extension (status quo) | Native app (Electron/Tauri) | **CLI + localhost dashboard (chosen)** |
|---|---|---|---|
| Works with any AI | ❌ Cursor only | ✅ | ✅ |
| Install burden | .vsix per window + mcp.json edit | installer per OS | `npm i -g` once |
| Can launch agents | ❌ | ✅ | ✅ |
| Session survives editor close | ❌ | ✅ | ✅ |
| Visual monitoring | webview panel | ✅ native windows | ✅ browser page |
| Build & maintenance cost | high (editor API churn) | **very high** (packaging, signing, updates × 2 OS) | low (Node + static page) |
| Scriptable / CI-able | ❌ | ❌ | ✅ |

## Why not the extension (leaving the status quo)

The extension was the right 2025 answer to a constraint that no longer binds: Cursor's chat
could not be driven programmatically, so a panel with a copy button was the best possible UX.
Now that headless CLIs exist (`claude -p`, `cursor-agent -p`), the extension's remaining value
is monitoring UI — while its costs stay: Cursor-only, per-window installs, webview lifecycle
hacks, and the server dying with its host window
([01-current-state/06-strengths-and-weaknesses.md](../01-current-state/06-strengths-and-weaknesses.md)).

## Why not a native desktop app (yet)

The user-experience argument for an app is real: non-terminal users, visual session control,
approachability. But every point of it is satisfied by the **dashboard** — a static page served
by the hub at `localhost:3131`
([03-core-concepts/dashboard.md](../03-core-concepts/dashboard.md)) — at a fraction of the cost:

- An app adds: packaging/signing/notarization × macOS+Linux, an update channel, a second UI
  codebase, and weeks of shell work — all before it does anything the dashboard doesn't.
- The one thing an app adds that a page can't (OS-level niceties: tray icon, native
  notifications) is not on the critical path of any user story we have.
- **The path stays open**: if adoption ever justifies it, a Tauri shell can wrap the *same*
  dashboard page and CLI-owned hub with near-zero rework. Deciding "not now" costs nothing
  later — deciding "app first" costs weeks now.

## Why the CLI is the primary interface (not just a fallback)

- The daily loop is terminal-shaped: `duo start "goal"` → watch → `duo approve` → done.
  Developers already live there; the target users run `claude` and `cursor-agent` in terminals
  by definition.
- Scriptability for free: CI experiments, cron-driven runs, piping `duo logs`.
- Both prior generations already converged on it: the extension grew a control terminal
  (`duoControlCli.ts`), and Conductor was CLI-first from birth. This decision ratifies what
  usage already discovered.

## Revisit triggers

Reopen the native-app question only if one of these becomes true:

1. A significant user segment can't or won't use a terminal *and* the dashboard-in-browser
   proves insufficient for them.
2. An OS capability becomes load-bearing (e.g. native notifications for checkpoint approvals
   turn out to be the difference between gates working and gates ignored).
3. Distribution requires an artifact npm can't provide (enterprise packaging).

## 2026-07 update: trigger 1 fired — decision revised

First real-user feedback after v1: the CLI surface is too hard (too many commands, no visual
folder/agent/role setup), and a desktop app was explicitly requested. Triggers 1 and 2 (native
notifications for approvals) both apply. The revised decision:

- **Desktop app approved** — [phase 7](../05-implementation-plan/phase-07-desktop-app.md),
  **Electron** rather than the Tauri guess above: the hub is a Node library, so Electron runs it
  in-process (no sidecar binary, no second language). Trade-off (footprint vs. simplicity)
  recorded in the phase doc.
- The core of *this* document survives: the app is a **shell over the same REST/SSE surface and
  the same UI codebase** as the browser dashboard; the CLI remains a full-parity client for
  power users and scripting. What's abandoned is only "browser is enough."

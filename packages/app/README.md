# BroCode Desktop App (Electron)

The zero-terminal way to use BroCode: a native window with a setup wizard, an **OS folder picker**,
session control, and OS notifications when an approval is waiting.

## What it is

An Electron shell that:

- **Runs the hub in-process** (`import { Hub }` — the hub is a Node library, so no sidecar binary
  and no second language; this is why Electron beats Tauri for this codebase).
- **Loads the hub-served dashboard** at `http://127.0.0.1:<port>/` — the *same* UI the browser
  uses, so there is one UI codebase, not two.
- Adds the two things a web page can't do, via a small preload bridge:
  - `duoNative.pickFolder()` → native OS directory dialog (the wizard's **Browse…** button).
  - `duoNative.notify()` → OS notification when a plan or checkpoint needs you.
- **Coexists with the CLI**: if a hub is already running on the configured port (e.g. a `duo`
  session), the app attaches to it instead of starting a second one.

The dashboard feature-detects `window.duoNative`; without it (plain browser) it falls back to the
`/api/fs/list` folder browser — so setup works in both.

## Run it (dev)

```bash
cd packages
npm install          # installs electron (a large download, first time only)
npm run build:app    # builds the workspace + typechecks the app
cd app && npm start   # launches the Electron window
```

On first launch with no config, the window opens on the **setup wizard**: pick a folder per agent
(native dialog), choose the runner (live ✓/✗ detection), name the role, then start a session — all
without a terminal.

## Package installers

```bash
cd packages/app && npm run dist    # electron-builder → dmg (macOS), AppImage/deb (Linux)
```

Signing/notarization (macOS) requires certificates; unsigned dev builds open via right-click →
Open. Clean-machine installer smoke tests are the remaining phase-7 step
(see [../../docs/05-implementation-plan/phase-07-desktop-app.md](../../docs/05-implementation-plan/phase-07-desktop-app.md)).

## Files

```
src/main.ts      Electron main: in-process hub (attach-or-start), window, tray, native bridge handlers
src/preload.ts   contextBridge → window.duoNative { pickFolder, notify }
```

The screens (wizard, start, live session, review cards) all live in the shared dashboard
(`packages/hub/dashboard/index.html`), not here — the app is just the native shell around it.

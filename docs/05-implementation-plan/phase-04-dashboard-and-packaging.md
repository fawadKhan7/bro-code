# Phase 4 — Dashboard & Packaging

## Goal

Make the system usable by people who didn't build it: a localhost dashboard served by the hub,
`npm i -g` installation under a real package name, and user-facing documentation. v1 ships at
the end of this phase.

## Why this phase exists

Phases 1–3 produce a complete but builder-shaped tool. Two gaps remain for everyone else:
**visual monitoring/approval** (watching interleaved agent activity and reviewing plans is
better in a browser — the successor to the extension's panel), and **frictionless install**
(clone-and-build is not a distribution story). It runs last because the CLI already covers every
function — this phase adds comfort and reach, not capability
([04-strategies-and-design-principles/extension-vs-cli-decision.md](../04-strategies-and-design-principles/extension-vs-cli-decision.md)).

## Scope

**In:** dashboard page (static, hub-served), packaging/publish pipeline, user docs (README,
quickstarts, troubleshooting), first-run polish (`duo init` UX, error message audit).
**Out:** native app shell, Windows support, N>2 UX, scanner language expansion — all backlog
([00-roadmap.md](00-roadmap.md#post-v1-backlog-recorded-deliberately-deferred)).

## Architecture changes

None to protocol or state. The hub gains one static-file route (`GET /`); the dashboard is a
pure client of existing REST + SSE surfaces — **zero private endpoints**, preserving CLI/dashboard
parity ([03-core-concepts/dashboard.md](../03-core-concepts/dashboard.md)).

## Files/packages involved

`packages/hub/dashboard/` (single HTML + vanilla JS/CSS, no build framework — reworking
`src/panel/webview.html`'s structure from webview message-passing to `fetch` + `EventSource`);
`packages/cli` (publish config, bin name); repo root (README rewrite, LICENSE, publish workflow).

## Implementation steps

1. Dashboard: session header, board view (status/claimant, unassigned highlighted), live
   activity stream, contracts browser, review cards (plan approval with assign controls;
   checkpoint approve/feedback) — all against existing endpoints.
2. Reconnect handling: `EventSource` retry + versioned re-sync (`since_version`) so a laptop
   sleep doesn't desync the page.
3. Packaging: decide the npm name (check availability — `duo` is almost certainly taken;
   candidates recorded in the publish PR), `bin` entry, `files` allowlist, Node engine range,
   `npm pack` smoke test on a clean machine/container for macOS + Linux.
4. User docs: quickstarts per combination (claude↔claude, mixed, cursor↔cursor), a
   troubleshooting page generated from `duo doctor`'s catalog, and migration notes for existing
   Duo Agent extension / Conductor users.
5. First-run audit: every error message names its fix; `duo init` validates workspaces and
   detects runners as it prompts.
6. Legacy retirement: `src/` and `conductor/` moved to a `legacy/` folder (or archive branch)
   with pointers into these docs — after a final parity check against
   [01-current-state/](../01-current-state/).

## Dependencies

Phases 1–3 complete. npm publish access; name decision.

## Risks

| Risk | Mitigation |
|---|---|
| Dashboard scope creep (frameworks, theming, features) | One static page, vanilla JS, feature list frozen to step 1's panels |
| npm name conflicts / rename churn | Name decided and squatted early in the phase; CLI bin aliased so docs stay stable |
| Clean-machine install failures (Node versions, workspaces hoisting) | Container-based install smoke tests in CI for both OSes |

## Testing approach

Dashboard: manual matrix against live sessions + a scripted fake-agent session driving all UI
states (pending plan, unassigned items, checkpoint, crash/resume, done); browser reconnect test
(kill hub, restart, page re-syncs). Packaging: containerized `npm i -g <tarball>` → `duo init`
→ fake-session run on clean macOS and Linux images.

## Acceptance criteria

1. A newcomer with only the README completes: install → `duo init` → mixed-runner session →
   plan approval and one checkpoint **entirely from the dashboard** → `done`.
2. Dashboard survives hub restart and laptop sleep without stale state (versioned re-sync).
3. `npm i -g` from the published package works on clean macOS and Linux; `duo doctor` passes.
4. Every dashboard action has a CLI equivalent (parity audit).
5. Legacy code retired with pointers; repo README describes the new system only.

## Definition of Done

v1 tagged and published; install smoke tests in CI; docs complete (quickstarts, troubleshooting,
migration); backlog groomed with everything deferred during phases 1–4; the
[docs/](../README.md) tree updated where implementation diverged from this blueprint —
**the blueprint must end the phase true, not aspirational.**

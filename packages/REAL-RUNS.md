# Real-agent run log

Token-spending end-to-end runs with real AI agents (opt-in; not part of CI). Each entry records
the environment, outcome, and any vendor quirk found + fixed. Tokenless CI covers the protocol;
these prove real MCP attachment and coordination.

## 2026-07-11 — cursor-cli ↔ claude-code (mixed session) ✅

**Environment:** cursor-agent `2026.07.01-41b2de7`, Claude Code `2.1.200`, macOS.
**Config:** Agent A = cursor-cli (Frontend), Agent B = claude-code (Backend), `--no-plan`, auto-run.
**Goal:** "Add a service health check (files only): backend `server.js` with `GET /health →
{status:'ok', service:'api'}` + post a contract; frontend `healthCheck.js` exporting
`checkHealth(baseUrl)` built from the backend contract."

**Outcome:** Session reached `done`. Both agents registered over real MCP, claimed their board
items, exchanged contracts, and produced correct files:
- `api/server.js` — exact `GET /health` route; `api/contracts/health.md` mirrored (contentHash recorded).
- `web/healthCheck.js` — `checkHealth(baseUrl)` fetching `${baseUrl}/health`, built **from B's
  `health` contract** ({ status, service }). Cross-agent coordination confirmed.

**Bug found + fixed (claude-code adapter):** the first attempt failed — Agent B reported *"the duo
coordination tools aren't being granted permission, so I can't register."* `--permission-mode
acceptEdits` grants file edits but **not** MCP tool calls. Fix: the adapter now also passes
`--allowedTools "mcp__duo"` (server-level, covers all 16 tools). Pinned by a regression unit test
(`buildClaudeArgs`). The registration-deadline gate behaved correctly during the failure —
loud, specific error naming the likely cause, no hang.

**Notes:** cursor-cli attached over streamable HTTP with no issue (spike had already pre-approved
via `mcp enable`; launch also passes `--approve-mcps`). Held vs polling untested for cursor under
plan mode — this run used `--no-plan`.

## 2026-07 — Phase 5 (legible contracts + approvals) — dashboard verified

**How:** scripted MCP clients (demo-driver) posting the new v2 fields, driven through the browser
dashboard end to end (plan → approve → checkpoint → done).

**Verified live in the browser:**
- Plan summaries render in plain language above the item list ("I'll add a 'Sign in with Google'
  button, handle the redirect back, and store the session securely").
- Contract card headline is the plain-language `summary` ("After Google sign-in, the callback
  returns a login token plus the user's id and email"), not a raw blob; activity log shows it too.
- Checkpoint card shows **Why it's asking** / **If you approve** in non-engineer language; the
  full plan→approve→checkpoint→done cycle was driven from the dashboard.
- Ask-a-question loop (kind:"question" → answer via feedback) covered by the tokenless suite.

**Pending (opt-in real-AI run):** confirm real agents *fill* `summary`/`why`/`impact`/`plan_summary`
usefully — this phase's real risk is prompt compliance, not plumbing. Prompts are golden-tracked
and ready to iterate against a live run.

## 2026-07 — Phase 6 (hub-owned sessions) — endpoints verified

**How:** the full session lifecycle is now driven over REST against a hub that owns the agents;
the tokenless CLI suite exercises `/api/session/start|stop|resume` end to end with scripted agents.
Setup endpoints smoke-tested against a real daemon:
- `/api/runners/detect` → claude-code 2.1.200 ✓, cursor-cli 2026.07.09 ✓, cursor-ide (manual) ✓
- `/api/fs/list` → home-sandboxed (parent=null at home; `/etc` traversal rejected)
- `/api/session/start` validation → 409 without config, 400 without a goal; `/api/config` PUT ok
- `GET /` dashboard → 200

**Pending (opt-in real-AI run):** a live claude↔cursor session started via `curl` to
`/api/session/start` reaching `done` — the token-spending confirmation of the moved boundary.

## 2026-07 — Phase 7 (desktop app) — GUI control-plane verified in browser

**Verified live in the browser** (the dashboard is also the app's UI):
- Setup **wizard** renders when no config exists — per-agent folder field + Browse button, runner
  dropdowns with live detection (claude-code ✓, cursor-cli ✓, cursor-ide ✓), roles, preset, mode.
- **Folder browser** (the requested feature): opened at `/Users/Apple`, listed real directories,
  navigated into `Projects`, and "Use this folder" wrote the path back into the field and closed.
- Save → transitioned to the **start screen** showing the configured agents; start posts to
  `/api/session/start`.

**Electron shell:** built and typechecked (`tsc -p app` clean) — in-process hub (attach-or-start),
window loads the localhost dashboard, preload bridge exposes `duoNative.pickFolder` (native OS
dialog) + `duoNative.notify` (OS notifications), tray. Not auto-launched (GUI window on the user's
machine).

**Pending (opt-in):** launch the Electron window on a real display; `electron-builder` installer
smoke on clean macOS + Linux.

## Matrix status

| A | B | Status |
|---|---|---|
| cursor-cli | claude-code | ✅ verified 2026-07-11 |
| claude-code | cursor-cli | ⏳ symmetric to the above; not yet run live |
| cursor-cli | cursor-cli | ⏳ not yet run live |
| cursor-ide | claude-code | ⏳ manual-paste flow; not yet run live |
| claude-code | claude-code | ⏳ not yet run live (orchestration proven tokenlessly) |

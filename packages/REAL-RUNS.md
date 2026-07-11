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

## Matrix status

| A | B | Status |
|---|---|---|
| cursor-cli | claude-code | ✅ verified 2026-07-11 |
| claude-code | cursor-cli | ⏳ symmetric to the above; not yet run live |
| cursor-cli | cursor-cli | ⏳ not yet run live |
| cursor-ide | claude-code | ⏳ manual-paste flow; not yet run live |
| claude-code | claude-code | ⏳ not yet run live (orchestration proven tokenlessly) |

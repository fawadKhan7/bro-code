# Phase 3 — Cursor Adapters (CLI + IDE Fallback)

## Goal

Cursor joins the matrix: `cursor-cli` (fully automatic via `cursor-agent`) and `cursor-ide`
(clipboard fallback) runners, mixed sessions (cursor↔claude, claude↔cursor, cursor↔cursor),
and `duo doctor` for environment diagnosis. This phase completes the project's original goal
statement.

## Why this phase exists

Cursor is half the product promise but the riskiest integration: `cursor-agent`'s MCP support
in print mode has community-reported quirks (requires `--force`; open reports of MCP tools not
attaching). Doing it *after* the architecture is proven on Claude Code means any failure here is
attributable to the adapter/vendor layer — and the per-slot fallback design absorbs it
([04-strategies-and-design-principles/adapter-isolation.md](../04-strategies-and-design-principles/adapter-isolation.md)).

## Scope

**In:** cursor-cli adapter, cursor-ide adapter, `duo doctor`, prompt variants for polling,
mixed-session validation, per-slot fallback UX.
**Out:** dashboard, packaging (phase 4); any new hub tools (the protocol stays frozen).

## Architecture changes

None. Two new adapter modules + one CLI command, all behind existing interfaces.

## Files/packages involved

`packages/adapters/cursor-cli/`, `packages/adapters/cursor-ide/`, `packages/cli` (`doctor`,
resume/re-paste flow for manual slots), `packages/shared/src/prompts/` (polling variant if
enabled by default for cursor-cli).

## Implementation steps

1. **Spike first (time-boxed):** manual probe of `cursor-agent -p --force` + project
   `.cursor/mcp.json` against the phase-1 hub — verify MCP attachment, tool calls, and held-call
   tolerance. The spike's findings decide the adapter's default prompt variant and transport URL
   (streamable HTTP vs legacy `/sse`). Findings are committed as a notes file in the adapter.
2. cursor-cli adapter: `.cursor/mcp.json` merge-write; spawn
   `cursor-agent -p "<kickoff>" --force --output-format stream-json`; stream parsing; startup
   self-check (registration deadline → specific diagnosis naming the cursor-ide fallback).
3. cursor-ide adapter: config write; clipboard kickoff (`pbcopy`/`xclip`/`wl-copy`); launch
   resolves on `register_agent`; `duo resume` re-paste flow for manual slots.
4. `duo doctor`: per-runner `detect()` (binary, version), hub health, port conflicts, MCP
   attachment probes, stale state detection — each finding paired with its fix command.
5. Mixed-session validation matrix (below); document per-combination quirks in adapter headers.

## Dependencies

Phase 2 complete. Cursor + cursor-agent installed for real runs. Vendor risk: cursor-agent
behavior may shift between its releases — `detect()` records the version; known-bad versions
are named in the adapter with a doctor warning.

## Risks

| Risk | Mitigation |
|---|---|
| MCP never attaches in print mode on some versions | Self-check → loud failure → cursor-ide fallback per slot; doctor probe catches it pre-session |
| Held calls time out under cursor-agent | Polling-variant kickoff selected by this adapter (hub supports both since phase 1) |
| Streamable HTTP unsupported/buggy in a Cursor version | Legacy `/sse` config URL — one line inside the adapter |
| Clipboard tooling absent (Linux variants) | Detect `xclip`/`wl-copy`; fall back to printed prompt with clear instructions |

## Testing approach

Unit (mocked spawn/clipboard) for both adapters; tokenless CI integration as in phase 2 (adapters
mocked to fake agents); real smoke matrix opt-in. Every real-run failure gets reproduced as a
fake-agent scenario (protocol) or golden-prompt change (instruction) before fixing.

## Acceptance criteria

The validation matrix passes with real agents (small fixture goal, plan → approve → execute → done):

| A | B | Must pass |
|---|---|---|
| claude-code | cursor-cli | ✅ |
| cursor-cli | claude-code | ✅ |
| cursor-cli | cursor-cli | ✅ |
| cursor-ide | claude-code | ✅ (manual paste for A; registration-confirmed) |

Plus: forcing a cursor-cli MCP failure (bad config) produces the diagnostic + fallback message,
never a hang; `duo doctor` correctly reports a healthy and a deliberately broken environment.

## Definition of Done

Matrix transcripts committed; quirks documented per adapter (incl. spike notes and known-bad
versions); doctor covers every failure mode met during the phase; tokenless CI green; README
gains the mixed-session quickstart.

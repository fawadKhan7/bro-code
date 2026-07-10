# Phase 2 — CLI & Claude Code Adapter

## Goal

The first real end-to-end run: `duo start "goal"` launches two **Claude Code** agents that plan,
wait for `duo approve`, and execute collaboratively — no copy-paste anywhere. This is also the
claude↔claude mode shipped complete.

## Why this phase exists

Phase 1 proved the protocol with scripts; this phase proves it with real LLMs — specifically the
riskiest *architectural* mechanic: the held `await_plan_approval` call keeping a live agent
process blocked-but-alive through human approval
([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md)).
Claude Code is chosen first because it is the most reliable headless CLI with first-class MCP —
if something breaks here, it's our bug, not a vendor quirk.

## Scope

**In:** `packages/cli` (all commands except `doctor`'s multi-runner checks), the adapter
interface + common launcher utilities, the claude-code adapter, the prompt builder (kickoffs,
resume kickoffs, prompt variants) with golden-file tests.
**Out:** Cursor adapters (phase 3), dashboard (phase 4).

## Architecture changes

None to the hub (that's the point — phase 1 froze the protocol). New components only:
CLI ([03-core-concepts/cli.md](../03-core-concepts/cli.md)), adapter interface
([02-architecture-upgrade/04-adapter-architecture.md](../02-architecture-upgrade/04-adapter-architecture.md)),
prompt builder in `packages/shared`.

## Files/packages involved

Create `packages/cli`, `packages/adapters` (interface, common utils, `claude-code/`),
`packages/shared/src/prompts/`. Reuse `duoControlCli.ts`'s status-board rendering and REST/SSE
client patterns.

## Implementation steps

1. Adapter interface (`detect/configure/launch/stop`, `AgentHandle`) + common utilities:
   stream-json → hub-log piping, premature-exit watcher, registration-deadline check.
2. Claude Code adapter: `.mcp.json` merge-write (idempotent), spawn
   `claude -p "<kickoff>" --output-format stream-json` in workspace, permission-mode flag from
   config.
3. Prompt builder: kickoff assembly (brief + binding + map + protocol + mode), planning and
   no-plan variants, held-call and polling variants, resume kickoff. Golden-file tests.
4. `duo init` (interactive config → `~/.duo/config.json`) and `duo start` (config → scan → hub
   spawn/reuse → configure → launch → registration gate → watch).
5. Control commands as thin REST clients: `plan`, `approve` (incl. `--assign`, `--edit`),
   `feedback`, `status [--watch]`, `logs`, `resume`, `stop [--clean]`.
6. Hub lifecycle management: PID file, `/health` probe, port conflicts, stale-hub cleanup.
7. Real-agent smoke run (opt-in): tiny two-workspace fixture, one-feature goal, full session.

## Dependencies

Phase 1 complete. Claude Code installed for smoke runs (CI uses mocked spawns; real runs are
opt-in via `DUO_REAL_AGENTS=1` — [04-strategies-and-design-principles/testing-strategy.md](../04-strategies-and-design-principles/testing-strategy.md)).

## Risks

| Risk | Mitigation |
|---|---|
| Held tool call fails under real client timeouts | Timeout+retry semantics already in hub; polling-variant kickoff ready; decide default per observed behavior |
| Agents don't follow kickoff protocol reliably | Iterate prompt text (golden-file-tracked); tighten tool descriptions — schema nudges beat prose |
| `claude -p` permission prompts stall headless runs | Explicit permission-mode config at `duo init`, documented default, surfaced in errors |
| Long-running `claude -p` session limits | Premature-exit watcher + `duo resume` with resume brief already designed |

## Testing approach

Unit: prompt-builder golden files; adapter arg/config assembly (mocked spawn); CLI command → REST
mapping. Integration: CLI against a real hub with fake agents standing in for launched processes
(adapter mocked to connect a fake agent — validates the whole orchestration path tokenlessly).
Real smoke: acceptance runs below.

## Acceptance criteria

1. Fresh machine flow: `duo init` → `duo start "goal"` → both Claude Code agents register,
   plan, block; `duo plan` shows the merged board; `duo approve --assign …` resumes **the same
   processes** (verified by PID) into execution; session reaches `done` under the completion rule.
2. `duo status --watch` streams live updates from both agents.
3. Checkpoint mode: agent pauses; `duo feedback` alters its behavior; session completes.
4. Kill one agent mid-execution: claims reopen; `duo resume` brings a replacement back via
   resume brief; session completes.
5. `--no-plan` run executes the preset-derived board without a planning phase.

## Definition of Done

Acceptance runs recorded (transcripts committed as fixtures); tokenless CI suite green;
golden prompts reviewed; README quickstart for claude↔claude written; known claude-code
quirks documented in the adapter header.

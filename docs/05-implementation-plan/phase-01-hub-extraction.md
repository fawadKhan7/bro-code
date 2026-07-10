# Phase 1 — Hub Extraction & New State Model

## Goal

A standalone hub process implementing the full v1 protocol — task board, planning phase, phase
gates, contracts, checkpoints, persistence, both MCP transports — proven by a fake-agent test
suite that runs a complete session without any AI.

## Why this phase exists

Everything else (CLI, adapters, dashboard) is a client of the hub. Building the hub first —
against scripted clients — means the protocol is stable and regression-tested before any real
AI, real launch mechanics, or vendor quirks can confound debugging. This phase also pays down
the two structural debts of the old generations: the editor-bound server and the hard-coded
A/B pair.

## Scope

**In:** monorepo scaffold; hub package with all tools and surfaces; shared package (types,
presets, scanner, contract disk, session persistence); fake-agent client + test harness + suite.
**Out:** the `duo` CLI (phase 2), all adapters (phases 2–3), dashboard (phase 4), any prompt
building (phase 2).

## Architecture changes

- Server code leaves the extension; new home `packages/hub`
  ([02-architecture-upgrade/02-standalone-hub.md](../02-architecture-upgrade/02-standalone-hub.md)).
- `taskA/taskB` → task board + `agents: AgentConfig[]`
  ([02-architecture-upgrade/05-task-board-model.md](../02-architecture-upgrade/05-task-board-model.md)).
- Session phases `planning → executing → done` with phase gates
  ([02-architecture-upgrade/06-planning-protocol.md](../02-architecture-upgrade/06-planning-protocol.md)).
- MCP via official SDK, streamable HTTP primary + legacy SSE compat
  ([02-architecture-upgrade/03-mcp-transport-upgrade.md](../02-architecture-upgrade/03-mcp-transport-upgrade.md)).
- Write-through persistence to `~/.duo/session.json`
  ([04-strategies-and-design-principles/state-management.md](../04-strategies-and-design-principles/state-management.md)).

## Files/packages involved

Create `packages/shared`, `packages/hub`, `packages/hub/test` (harness + fake agents).
Port from: `src/mcpServer.ts`, `src/contractDisk.ts`, `src/taskFileWriter.ts`,
`conductor/shared/src/*` (per the [salvage map](00-roadmap.md#salvage-map-what-moves-where)).
Existing `src/` and `conductor/` remain untouched.

## Implementation steps

1. Monorepo scaffold (npm workspaces, TS project refs, test runner).
2. `packages/shared`: types (AgentConfig, BoardItem, SessionState, phases), config paths,
   ported presets/scanner/contract-disk/resume-brief.
3. Hub core: state store + write-through persistence + versioned counters + SSE emitter.
4. Tool implementations (transport-agnostic functions): register/board/plan/contracts/
   checkpoints/status/resume-brief, with phase gates, claim validation, completion rule,
   idempotent re-calls.
5. Transports: streamable HTTP (SDK) + ported legacy SSE, both fronting step 4's functions.
6. REST control surface + `/api/updates` SSE.
7. Fake-agent client library + harness; scenario suites (happy path, `--no-plan` board
   pre-fill, races, rule enforcement, recovery, chaos, transport parity —
   [04-strategies-and-design-principles/testing-strategy.md](../04-strategies-and-design-principles/testing-strategy.md)).

## Dependencies

`@modelcontextprotocol/sdk`, TypeScript, a test runner (vitest). No other runtime deps —
the hub stays as dependency-light as the code it replaces.

## Risks

| Risk | Mitigation |
|---|---|
| SDK's streamable HTTP session semantics differ from expectations | Transport-parity tests; legacy SSE fallback exists from day one |
| Held-call (long-poll) behavior through the SDK | Prototype `await_plan_approval` early in step 5; polling twin (`get_plan_status`) specified regardless |
| Scope creep into CLI/prompt territory | Phase boundary: nothing in this phase generates prompts or spawns processes |

## Testing approach

The fake-agent suite *is* the phase (see step 7) — plus unit tests for merge logic, claim
validation, persistence round-trips, and scanner/preset ports (behavior-pinned against the
originals).

## Acceptance criteria

1. Two fake agents complete a full session — plan → merge → REST approval (with reassignment of
   an unassigned item) → claims → contracts (delta reads) → checkpoint → completion — with the
   completion rule enforced.
2. The same scenario passes over both transports.
3. `kill -9` on the hub mid-execution, restart, fake agents continue: no state lost.
4. A disconnected fake agent's claims reopen; a chaos agent cannot hang or corrupt the hub.
5. All state assertions hold against both memory (REST reads) and the persisted file.

## Definition of Done

All acceptance scenarios green in CI on macOS and Linux; suite runs < 30s; hub boots standalone
(`node packages/hub/dist/index.js --port 3131`) and answers `/health`; no VS Code imports
anywhere in `packages/`; salvage-map items either ported or explicitly deferred in the backlog.

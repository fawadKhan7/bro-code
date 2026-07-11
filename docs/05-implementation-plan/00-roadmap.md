# Implementation Roadmap — Overview

> Four phases, each ending with something runnable. The riskiest unknowns are proven earliest;
> the polish comes last.

## The phases at a glance

| Phase | Deliverable | Status |
|---|---|---|
| [1 — Hub extraction](phase-01-hub-extraction.md) | Standalone hub + new state model + fake-agent test suite | ✅ done — 41 hub tests |
| [2 — CLI + Claude adapter](phase-02-cli-and-claude-adapter.md) | `duo start` with two Claude Code agents, end to end | ✅ done — CLI + golden prompts + orchestration tests |
| [3 — Cursor adapters](phase-03-cursor-adapters.md) | cursor-cli + cursor-ide runners; mixed sessions; `duo doctor` | ✅ done — validated by a live cursor↔claude run |
| [4 — Dashboard + packaging](phase-04-dashboard-and-packaging.md) | Localhost dashboard; `npm i -g`; docs | ◐ dashboard built & verified; packaging configured, publish pending |

## Implementation reality (divergences from the original blueprint)

Recorded so the blueprint stays true, not aspirational:

- **Claude Code MCP permission** (found in the first real run): `--permission-mode acceptEdits`
  grants file edits but *not* MCP tool calls. The adapter also passes `--allowedTools "mcp__duo"`.
  See [`packages/REAL-RUNS.md`](../../packages/REAL-RUNS.md).
- **Cursor MCP approval quirk** (found in the phase-3 spike): a freshly-configured server is
  "not loaded (needs approval)". Fixed by `cursor-agent mcp enable` in `configure()` + `--approve-mcps`
  at launch. Streamable HTTP attaches fine — legacy `/sse` stays unused (kept only as a safety net).
  See [`packages/adapters/src/cursor-spike-notes.md`](../../packages/adapters/src/cursor-spike-notes.md).
- **Real-run matrix**: cursor-cli↔claude-code verified live; other combinations are symmetric or
  proven tokenlessly, and remain opt-in real runs.
- **Legacy code retired**: `src/` and `conductor/` moved to `legacy/` with pointers (this doc's
  salvage map is complete).

## Sequencing logic

- **Fake agents before real agents** (phase 1): every later phase inherits a regression net that
  runs in milliseconds and costs nothing
  ([04-strategies-and-design-principles/testing-strategy.md](../04-strategies-and-design-principles/testing-strategy.md)).
- **Claude Code before Cursor** (phase 2 before 3): the most reliable headless CLI validates the
  architecture, so Cursor's known MCP quirks later land on a *working* system and are
  attributable to the adapter, not confounded with protocol bugs.
- **Dashboard last** (phase 4): the CLI is fully sufficient to operate the system from phase 2
  onward; the dashboard is comfort, not capability
  ([04-strategies-and-design-principles/extension-vs-cli-decision.md](../04-strategies-and-design-principles/extension-vs-cli-decision.md)).

## Target package layout (established in phase 1)

```
packages/
  shared/     ← types, presets, scanner, prompt builder, config paths
  hub/        ← the hub server (MCP + REST + SSE + state + persistence)
  adapters/   ← common interface + claude-code / cursor-cli / cursor-ide
  cli/        ← the `duo` command
```

Existing code (`src/`, `conductor/`) stays untouched as reference until parity, then is removed.

### Salvage map (what moves where)

| Existing | Destination | Reuse |
|---|---|---|
| `src/mcpServer.ts` (state, tools, REST, SSE) | `packages/hub` | ~70% — generalized to agent-list + board |
| `src/contractDisk.ts`, `src/taskFileWriter.ts` | `packages/shared` | near-verbatim |
| `conductor/shared` (presets, scan, session types, resume brief, rules) | `packages/shared` | near-verbatim |
| `src/duoControlCli.ts` (status board, watch, REST client) | `packages/cli` | structure + rendering |
| `src/panel/webview.html` | dashboard (phase 4) | UI structure, re-wired to fetch/SSE |
| `src/mcpToolCatalog.ts` | replaced by SDK-typed tool definitions | schemas as reference |

## Cross-phase rules

- The fake-agent suite is a merge gate from the end of phase 1 onward.
- No phase begins until the previous phase's Definition of Done is met.
- Prompt texts (kickoffs) live in `packages/shared` with golden-file tests — changes are always
  visible in diffs.
- Any discovered scope beyond a phase's document goes to the backlog, not into the phase.

## Post-v1 backlog (recorded, deliberately deferred)

- Scanner language coverage (Python/Go/Java; Next.js/FastAPI routes) — fast-follow after phase 4.
- N>2 agents UX (approval flows, log legibility).
- Real AST scanning (tree-sitter) behind the same map format.
- Native app shell (Tauri) — only if the [revisit triggers](../04-strategies-and-design-principles/extension-vs-cli-decision.md#revisit-triggers) fire.
- Windows support.

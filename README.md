# Duo

> Two (later N) AI coding agents — Cursor, Claude Code, or a mix — work on one goal in parallel,
> coordinated through a local MCP hub, driven by a single CLI. Zero API keys: agents run on your
> existing subscriptions; the orchestrator never calls an LLM.

```
        you ─► duo CLI ─► Hub (MCP + REST + SSE + dashboard) ◄─► Agent A (cursor / claude)
                                    ▲                        ◄─► Agent B (cursor / claude)
                              localhost dashboard
```

You give one goal. The agents — which have the codebases open — propose a task breakdown, you
approve it (assigning any cross-cutting work), and they execute in parallel: claiming board items,
sharing interfaces through versioned contracts, pausing at checkpoints you resolve. The session
finishes only when every board item is done or you mark it out of scope, so nothing is silently
dropped.

## Quickstart

```bash
cd packages && npm install && npm run build
node cli/dist/index.js init          # or npm-link to get `duo`
duo start "Add Google OAuth login"   # launches both agents; mix cursor + claude freely
duo plan && duo approve --assign t5=B
duo status --watch                   # or open http://localhost:3131 for the dashboard
```

## Where things are

| Path | What |
|---|---|
| [`packages/`](packages/) | The implementation (`shared`, `hub`, `adapters`, `cli`) + user docs |
| [`packages/README.md`](packages/README.md) | Install, quickstarts (claude↔claude, mixed, cursor↔cursor), commands |
| [`packages/TROUBLESHOOTING.md`](packages/TROUBLESHOOTING.md) | Common issues + fixes (start with `duo doctor`) |
| [`packages/MIGRATION.md`](packages/MIGRATION.md) | Moving from the old extension / Conductor |
| [`packages/REAL-RUNS.md`](packages/REAL-RUNS.md) | Real-agent run log (incl. the first live cursor↔claude session) |
| [`docs/`](docs/) | The full design blueprint — architecture, concepts, strategies, phase plans |
| [`legacy/`](legacy/) | The two archived generations (Duo Agent extension, Conductor). See [`legacy/README.md`](legacy/README.md) |

## Status

v1 in progress. Phases 1–3 complete and validated (hub + protocol, CLI + Claude Code adapter,
Cursor adapters + mixed sessions — proven with a live cursor↔claude run). Phase 4 (this): the
localhost dashboard is built and verified; npm publishing is configured but not yet released
(see [`packages/PUBLISHING.md`](packages/PUBLISHING.md)).

## Requirements

Node 20+. For real sessions: [Claude Code](https://claude.com/claude-code) and/or
[Cursor CLI](https://cursor.com/docs/cli) installed and authenticated. Run `duo doctor` to check.

MIT licensed.

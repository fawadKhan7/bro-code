# Current Repository Structure

> Snapshot of the repository as of July 2026, before the architecture upgrade.

The repository contains **two generations** of the same idea, side by side:

1. **Duo Agent** — a VS Code/Cursor extension (repo root + `src/`). The mature, feature-complete
   implementation. Requires installing a `.vsix` in every Cursor window.
2. **Conductor** — a CLI-first prototype (`conductor/`). The newer direction (no extension), but
   architecturally weaker (stdio server + shared JSON file coordination).

Neither is deleted during the upgrade; both serve as reference implementations until the new
system reaches feature parity. See [06-strengths-and-weaknesses.md](06-strengths-and-weaknesses.md)
for what is kept from each.

## Directory layout

```
BroCode/
├── README.md                 ← Duo Agent extension docs (user-facing)
├── instruction.md            ← Project journey & decision log (historical)
├── new-flow.md               ← Conductor design notes (historical)
├── package.json              ← Extension package (duo-agent)
├── tsconfig.json
├── duo-agent-0.0.6.vsix      ← Built extension installer
├── media/                    ← Extension icon assets
├── out/                      ← Compiled JS (tsc output)
├── scripts/
│   └── check-contracts.mjs   ← Minimal CI gate for contracts/*.md
├── src/                      ← DUO AGENT EXTENSION (generation 1)
│   ├── extension.ts          ← VS Code activation, commands, webview provider, proxy mode  (537 lines)
│   ├── mcpServer.ts          ← HTTP server: MCP SSE + REST API + all tool implementations (661 lines)
│   ├── mcpToolCatalog.ts     ← MCP tool JSON schemas                                       (193 lines)
│   ├── contractDisk.ts       ← Contract hashing + contracts/<service>.md disk mirror       (76 lines)
│   ├── taskFileWriter.ts     ← Writes TASKS.md to agent workspaces                         (57 lines)
│   ├── workspaceSetup.ts     ← Legacy CONTRACTS.md template writer                         (23 lines)
│   ├── duoControlCli.ts      ← Interactive session control terminal (task/status/watch)    (380 lines)
│   ├── duoDigestCli.ts       ← duo-digest.md generator (path listing)                      (101 lines)
│   └── panel/
│       └── webview.html      ← Sidebar panel UI (state machine, logs, checkpoints)
└── conductor/                ← CONDUCTOR PROTOTYPE (generation 2)
    ├── README.md             ← Conductor docs (user-facing)
    ├── shared/src/           ← Shared library
    │   ├── types.ts          ← Session/preset/update types
    │   ├── session.ts        ← Session load/save/mutate (~/.conductor JSON file)
    │   ├── presets.ts        ← Role presets + buildBriefs()
    │   ├── scan.ts           ← Regex-based project scanner ("project map")
    │   ├── rules.ts          ← .cursor/rules injection/removal
    │   ├── resumeBrief.ts    ← Condensed context after checkpoints
    │   ├── contractFormat.ts ← Contract delta formatting
    │   ├── config.ts / paths.ts / index.ts
    ├── mcp-server/src/       ← Stdio MCP server
    │   ├── index.ts          ← JSON-RPC dispatch
    │   ├── stdio.ts          ← Stdio transport
    │   ├── schemas.ts        ← Tool schemas
    │   └── tools.ts          ← Tool implementations (file-backed)
    └── cli/src/              ← conductor CLI
        ├── index.ts          ← Command dispatch
        ├── parseArgs.ts / prompt.ts / mcpSnippet.ts
        └── commands/         ← init / start / status / feedback / stop
```

## Line-count overview

| Area | Files | Lines (approx.) |
|---|---|---|
| Extension (`src/`) | 9 | ~2,000 |
| Conductor (`conductor/*/src/`) | 23 | ~1,200 |

## Which documents describe what

- Extension architecture → [02-duo-agent-extension.md](02-duo-agent-extension.md)
- Conductor architecture → [03-conductor-prototype.md](03-conductor-prototype.md)
- MCP layer (both) → [04-mcp-implementation.md](04-mcp-implementation.md)
- Coordination features (contracts, checkpoints, logs) → [05-coordination-mechanisms.md](05-coordination-mechanisms.md)
- Assessment → [06-strengths-and-weaknesses.md](06-strengths-and-weaknesses.md)

# Conductor

Coordinate two Cursor agents toward one goal — **no API keys**, preset-based briefs, shared MCP coordination.

## Build

```bash
cd conductor
npm install
npm run build
```

## Link CLI (optional)

```bash
npm link -w @conductor/cli
# or: node cli/dist/index.js init
```

## MCP setup

After `conductor start`, merge the printed snippet into `%USERPROFILE%\.cursor\mcp.json` (Windows) or `~/.cursor/mcp.json`, then restart Cursor.

## Commands

| Command | Description |
|---------|-------------|
| `conductor init` | Save paths for Agent A & B workspaces + default preset |
| `conductor start "<goal>"` | Scan codebases, inject rules, open session |
| `conductor status` | Progress and checkpoints |
| `conductor feedback [msg]` | Resume after checkpoint |
| `conductor stop` | Remove injected rules, clear session |

State lives in `~/.conductor/` (config + session). Injected rules: `.cursor/rules/conductor-session.mdc` in each workspace (removed on `stop`).

## Packages

- `@conductor/shared` — types, presets, scan, session store
- `@conductor/mcp-server` — stdio MCP tools
- `@conductor/cli` — terminal commands

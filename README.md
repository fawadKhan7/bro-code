# Duo Agent

Let two Cursor IDE instances collaborate on any task together via a shared MCP server.

**Conductor (new):** CLI-first coordination with preset briefs, no API keys — see [`conductor/README.md`](conductor/README.md). Build with `cd conductor && npm install && npm run build`, then `node cli/dist/index.js init`.

## How It Works

Two Cursor AI agents work in parallel — often in **different workspaces** (e.g. frontend + backend). They coordinate through a local MCP server — sharing task assignments, **versioned contracts** (with `contentHash` and per-service revisions), disk mirrors under `contracts/`, and live progress logs.

## Setup (One Time)

1. Install the **Duo Agent** extension in both Cursor windows.
2. In the window that will **start the server**, open the Duo sidebar → **Start server** → **Duo Agent: Open Session Terminal** (or let it open automatically). The terminal prints the **`mcp.json`** snippet — merge it into `%USERPROFILE%\.cursor\mcp.json` on each machine, then restart Cursor.
3. Done.

## Usage

1. **Start server** from the Duo sidebar in one window (that window can open **Session terminal** and **Stop server**). Other windows attach as clients; they use the same panel for **Connect** and **Live logs** only.
2. In **each** window, **Connect as agent** (A = first slot, B = second).
3. **Host window** (where you clicked **Start server**): use the **sidebar “Set tasks”** form (instructions + optional file scope + Auto-run / Checkpoint) for Agent A and B, **or** use the **Session terminal** (`task A …` / `task B …`, `status`, `watch on|off`, `disarm`, etc.). The CLI **subscribes to SSE** and refreshes the status board when registration or session state changes (throttled). Type `help` or `config` in the terminal anytime.
4. In **each** window, open **Agent chat** and use the **duo-agent** MCP tool **`get_my_task`**. The first call from each window counts as that agent “starting”; until **both** have called once, `get_my_task` returns **waiting** — poll again for the full task.
5. **Recommended:** Command Palette → **“Duo Agent: Install Protocol Rules”** in **each** repo/workspace. Writes `.cursor/rules/duo-protocol.mdc` generated from the **live MCP tool catalog** (re-run after extension upgrades).
6. Optional: a short Cursor rule (e.g. “start duo” → use duo-agent / `get_my_task`) in addition to the generated protocol.
7. **Optional static orientation:** after `npm run compile`, run **`npm run digest`** from a repo root to emit `duo-digest.md` (path listing only — conservative secret-path excludes). `@`-mention it in agent chat to reduce repo wandering.
8. Watch **Live logs** (and checkpoints) in the sidebar.

## MCP Tools Available to Agents

| Tool | Description |
|---|---|
| `get_my_task(agent_id)` | Get this agent's task; first call per agent from chat pairs the session — returns `waiting: true` until **both** agents have called once, then returns the full task |
| `get_mode()` | Get current session mode |
| `post_update(agent_id, message)` | Log progress to the panel |
| `get_logs()` | Read all agent logs |
| `post_contract(agent_id, content, title?, service?)` | Share an interface or agreement; **mirrors** to `contracts/<service>.md` in this agent’s workspace (slug from `service` arg or `service: slug` line in `content`). Returns `contentHash`, `revision`, `diskPath`. |
| `get_contracts()` | Read all contracts for this session — each includes `contentHash`, `timestamp`, `revision`, optional `title` / `service`, `diskPath` |
| `post_checkpoint(agent_id, summary, next_step)` | Request user review (Checkpoint mode) |
| `get_checkpoint_status(agent_id)` | Poll for user approval |
| `get_status()` | Session status (`armedA` / `armedB` = whether that agent has called `get_my_task` yet; `sessionReady` = both have) |
| `register_agent(workspace_path)` | Register this window as Agent A or B |

## Workspace Files

When you set tasks from the control terminal, **TASKS.md** is written to each agent’s workspace root. **CONTRACTS.md** may be created as a legacy template.

- **TASKS.md** — full task assignments and agent instructions
- **`contracts/<service>.md`** — every `post_contract` **prepends** a revision block (timestamp, agent, `contentHash`, body). One slug per file → fewer git merge conflicts than a single shared file. **CI:** run `npm run check-contracts` (set `CONTRACTS_REQUIRED=1` when contracts must exist) or add your own OpenAPI/schema diff on `contracts/*.md`.
- **duo-digest.md** — optional; produced by `npm run digest` (path tree only).

## Scripts (repo root)

| Script | Purpose |
|--------|---------|
| `npm run digest` | Write `duo-digest.md` (requires `out/` from `npm run compile`) |
| `npm run check-contracts` | Minimal CI gate for `contracts/*.md` (see `scripts/check-contracts.mjs`) |

## Requirements

- Cursor IDE with MCP support
- Node.js 18+

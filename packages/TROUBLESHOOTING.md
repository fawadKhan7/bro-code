# Troubleshooting

Start with **`duo doctor`** — it checks config, runner binaries, hub health, and (for cursor
runners) live MCP attachment, pairing each finding with its fix. Most issues below are things
doctor reports.

## Agents don't start / don't register

| Symptom | Cause | Fix |
|---|---|---|
| `Agents did not register within 30s: B. MCP likely did not attach` | The agent's MCP client never connected to the hub | See per-runner rows below; `duo doctor` pinpoints which runner |
| Claude agent says *"the duo tools aren't being granted permission"* | `--permission-mode acceptEdits` doesn't grant MCP tools | Already fixed in the adapter (passes `--allowedTools mcp__duo`). If you see it, rebuild — you're on an old build |
| Cursor: `duo: not loaded (needs approval)` in `cursor-agent mcp list` | Cursor's print-mode MCP approval gate | `duo start` runs `cursor-agent mcp enable duo` automatically; to fix by hand, run it in that workspace. Or switch the slot to `cursor-ide` |
| Cursor: `duo: Error: Connection failed` | Hub not running on the configured port | Start a session (`duo start`) or check `duo doctor` hub line; confirm the port in `~/.duo/config.json` |
| `cursor-agent` / `claude` "not found on PATH" | Binary missing | Install the CLI, or set `DUO_CURSOR_BIN` / `DUO_CLAUDE_BIN`; or use `cursor-ide` (needs no CLI) |

## Hub

| Symptom | Fix |
|---|---|
| `No hub running on port N` | Run `duo start "<goal>"` (spawns the hub) — control commands need it up |
| `A session is already active` | `duo status` to inspect; `duo stop` to archive and clear |
| Port conflict on 3131 | Change `port` in `~/.duo/config.json` (re-run `duo init` or edit directly) |
| Stale hub after a crash | `duo stop` clears the PID file; the next `duo start` cleans a dead PID automatically |

## Planning / board

| Symptom | Fix |
|---|---|
| `Cannot approve: unassigned items remain (tN)` | Assign them: `duo approve --assign tN=<agent>`, or `--out-of-scope tN` |
| Plan auto-approved without asking | Trivial-plan fast path (≤2 owned items). Expected; disable per session via the API or add items |
| Agent claims rejected: *"owned by Agent X"* | Claims are workspace/owner-validated — the peer owns it; coordinate via contracts instead |
| Session won't finish | The completion rule blocks `done` while items are open/claimed. Finish them or `duo out-of-scope tN` |

## Dashboard

| Symptom | Fix |
|---|---|
| Page shows `reconnecting…` | Hub restarted or asleep; `EventSource` auto-reconnects and the page re-syncs (also a 15s safety re-sync). If it persists, the hub is down |
| Activity feed empty at first load | It streams *new* events; history lives in the CLI/session archive. Refresh follows live from connect |
| Actions do nothing | Check the hub is reachable (same port as the page URL); the dashboard has no private endpoints — anything it does, the CLI can too |

## Resuming after a crash

- A crashed agent's claimed items reopen automatically; `duo start` auto-resumes it from a resume
  brief (bounded retries). If `duo start` isn't running: `duo resume <agent>`.
- Total orchestration loss (deleted `~/.duo/`) still leaves your actual work: files, contract
  mirrors (`contracts/*.md`), and `TASKS.md` are on disk in each workspace.

## Environment overrides (mostly for tests/dev)

| Var | Effect |
|---|---|
| `DUO_HOME` | Where config/session/history live (default `~/.duo`) |
| `DUO_CLAUDE_BIN` / `DUO_CURSOR_BIN` | Alternate agent binaries |
| `DUO_LONGPOLL_MS` | Held-tool-call timeout before a `{pending, retry}` response |

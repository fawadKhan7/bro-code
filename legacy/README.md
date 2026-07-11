# Legacy — archived generations

These are the two earlier generations of the project, kept for reference. **Neither is the current
system** — that's [`../packages/`](../packages/), driven by the `duo` CLI.

| Folder / file | What it was | Documented in |
|---|---|---|
| `src/`, `README-extension.md`, `package.json`, `media/`, `out/`, `duo-agent-0.0.6.vsix` | **Duo Agent** — the VS Code/Cursor extension (generation 1). Hosted an in-editor MCP server; two Cursor windows coordinated through it with manual kickoff copy-paste. | [`../docs/01-current-state/02-duo-agent-extension.md`](../docs/01-current-state/02-duo-agent-extension.md) |
| `conductor/` | **Conductor** — the CLI-first prototype (generation 2). Preset briefs, project scan, resume briefs; but a stdio MCP server per editor + a shared JSON session file (coordination races). | [`../docs/01-current-state/03-conductor-prototype.md`](../docs/01-current-state/03-conductor-prototype.md) |
| `instruction.md`, `new-flow.md`, `scripts/` | Original design/decision logs and the extension's contract-check script. | [`../docs/01-current-state/`](../docs/01-current-state/) |

## Why they were retired

The new system merges the strengths of both — the extension's single live server + push events,
and Conductor's CLI/presets/scan/deltas — and adds the two genuinely new pieces: **adapters**
(launch and configure any MCP-capable AI) and the **plan → approve → execute protocol over a task
board** (replacing rigid role splitting). The full rationale and the strengths/weaknesses mapping:
[`../docs/01-current-state/06-strengths-and-weaknesses.md`](../docs/01-current-state/06-strengths-and-weaknesses.md).

**Parity check:** every proven mechanism from these generations — contracts (hash/revision/disk
mirror), checkpoints, the arming→registration handshake, presets, the project scanner, resume
briefs — is carried into `packages/` (see the concept docs under
[`../docs/03-core-concepts/`](../docs/03-core-concepts/)). What was intentionally dropped: the
editor extension, proxy-mode window detection, and file-based coordination.

Nothing here is built or run by the current tooling; it can be removed once you no longer need it
for reference.

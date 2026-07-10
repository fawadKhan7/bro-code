# Decision: Adapter Architecture

> Everything AI-specific — how to configure MCP for a given AI and how to launch it with a
> kickoff prompt — is isolated in one small module per AI: an **adapter**. The hub and CLI
> never contain `if (cursor)` branches.

## The problem adapters solve

The original extension existed because of one limitation: you cannot programmatically inject a
prompt into Cursor IDE's chat. That forced manual copy-paste. Since then, both vendors shipped
headless CLIs (`claude -p`, `cursor-agent -p`) — so kickoff prompts *can* be delivered
programmatically, but **differently per AI**. Adapters contain those differences.

## The interface

```ts
interface AgentAdapter {
  runner: "claude-code" | "cursor-cli" | "cursor-ide";   // extensible

  /** Is this runner usable on this machine? (binary present, version ok) */
  detect(): Promise<DetectResult>;

  /** Write MCP config + any rules files into the agent's workspace. Idempotent. */
  configure(agent: AgentConfig, hubUrl: string): Promise<void>;

  /** Start the agent with its kickoff prompt. Returns a handle that lives
   *  until session end — the same process spans planning AND execution
   *  (hard invariant, see 07-long-lived-sessions.md). */
  launch(agent: AgentConfig, kickoffPrompt: string): Promise<AgentHandle>;

  /** Terminate / clean up. */
  stop(handle: AgentHandle): Promise<void>;
}

interface AgentHandle {
  agentId: string;
  kind: "process" | "manual";        // manual = human pasted the prompt (cursor-ide)
  events: EventEmitter;              // "output" | "exit" | "error" — piped into hub logs
}
```

Design rules:

- **Adapters are launchers, not protocols.** Once an agent is running, all coordination happens
  over MCP with the hub. Adapters never carry task data.
- **The CLI orchestrates, adapters execute.** `duo start` calls `detect → configure → launch`
  per slot; `duo doctor` calls `detect` on all adapters.
- **No adapter code in the hub.** The hub doesn't know or care what launched its MCP clients.

## The three v1 adapters

### 1. Claude Code adapter (`claude-code`) — the reference implementation

- **configure:** write project-scoped `.mcp.json` in the workspace pointing at
  `http://127.0.0.1:3131/mcp`.
- **launch:** spawn in the workspace:
  `claude -p "<kickoff>" --output-format stream-json` (permission flags per user config).
  Parse stream-json events → forward to hub logs so `duo status` shows agent activity.
- **Why first:** most reliable headless CLI, first-class MCP support, native streamable HTTP.
  It proves the architecture before Cursor quirks enter the picture.

### 2. Cursor CLI adapter (`cursor-cli`)

- **configure:** write `.cursor/mcp.json` in the workspace.
- **launch:** spawn `cursor-agent -p "<kickoff>" --force --output-format stream-json`.
- **Known risk:** MCP in cursor-agent print mode has community-reported quirks (needs `--force`;
  open bug reports about MCP tools not attaching in print mode). Therefore:
  - **Startup self-check:** the kickoff instructs the agent to call `register_agent` immediately;
    if the hub hasn't seen it within N seconds, the CLI fails loudly with a diagnosis
    ("MCP did not attach — try the cursor-ide fallback") instead of hanging silently.
  - **Long-poll fallback:** if held tool calls (`await_plan_approval`) misbehave under
    cursor-agent, this adapter switches the kickoff to the polling variant
    (`get_plan_status` with backoff) — a prompt-level change isolated here.

### 3. Cursor IDE adapter (`cursor-ide`) — the blockage escape hatch

For users who want the full IDE experience, or when `cursor-agent` misbehaves:

- **configure:** write `.cursor/mcp.json` (same as cursor-cli).
- **launch:** print the kickoff prompt, copy it to the clipboard (`pbcopy` / `xclip`), and
  instruct: *"Open this workspace in Cursor, paste into agent chat (Ctrl+L), press Enter."*
  The returned handle is `kind: "manual"`; launch resolves as "started" when the hub sees that
  agent's `register_agent` call — confirming the paste actually happened.
- This preserves generation 1's proven flow as a fallback, minus the extension: the hub replaces
  the extension server, and the clipboard replaces the panel's Copy button.

## Mixing runners

Runner choice is per slot in the session config, so every combination the project targets is
just configuration:

```jsonc
// ~/.duo/config.json (written by `duo init`)
{
  "agents": [
    { "id": "A", "workspace": "~/proj/web",  "runner": "cursor-cli",  "role": "Frontend" },
    { "id": "B", "workspace": "~/proj/api",  "runner": "claude-code", "role": "Backend" }
  ]
}
```

cursor↔cursor, cursor↔claude, claude↔cursor, claude↔claude — no special cases anywhere.

## Future AI provider support

Adding a runner (Codex CLI, Gemini CLI, Windsurf, …) means writing one adapter file that
implements the four methods — typically: which config file to write, which binary to spawn,
which flags select headless mode and output format. It touches no hub code, no CLI command code,
no other adapter, and inherits all coordination behavior automatically.
If a future AI supports MCP but has **no headless CLI**, it gets a manual adapter like
`cursor-ide` — clipboard kickoff + registration confirmation.

Isolation rationale and failure containment:
[04-strategies-and-design-principles/adapter-isolation.md](../04-strategies-and-design-principles/adapter-isolation.md).

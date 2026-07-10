# Strategy: Adapter Isolation

> All AI-vendor-specific knowledge lives in adapters — one module per runner, four methods,
> no exceptions. The moment a `runner === "cursor-cli"` branch appears outside `packages/adapters`,
> the architecture has failed.

## Why isolation is the load-bearing decision

The project's promise is "works with any AI, in any combination." That promise survives only if
AI-specific behavior is quarantined:

1. **Vendors churn.** cursor-agent's flags, MCP quirks, and print-mode behavior have changed
   repeatedly within a year. When they change again, the fix must be one file — not a hunt
   through hub, CLI, and prompts.
2. **The matrix must not explode.** With behavior in adapters, N runners = N modules. With
   behavior leaked into the core, N runners = N × (every code path that branched).
3. **Failures must be attributable.** When a session misbehaves, the first diagnostic question
   is "which layer?" Isolation makes the answer mechanical: coordination bug → hub (reproduce
   with fake agents, no AI needed); launch/attach bug → that slot's adapter; instruction bug →
   prompt builder.

## The boundary, precisely

**Adapters know:** where their runner's MCP config lives; which binary + flags launch headless
with a prompt; how to parse its output stream into log events; its known quirks and fallbacks
(e.g. polling-variant kickoffs, legacy-SSE config for a broken client version).

**Adapters never know:** tool semantics, board/contract/checkpoint logic, prompt *content*
(they deliver kickoffs; the shared prompt builder writes them), or other adapters' existence.

**The core never knows:** binaries, config file formats, process flags, vendor quirks.

```
CLI ──(AgentConfig, kickoff string)──► adapter ──(process/clipboard)──► agent
                                                                        │ MCP
hub ◄──────────────── anonymous MCP client, identified by register_agent┘
```

The hub's ignorance is total by design: it cannot distinguish a claude-code agent from a
cursor-agent from a fake test agent. That's also *why* fake-agent testing works
([testing-strategy.md](testing-strategy.md)).

## Failure containment in practice

The user-facing payoff is the **per-slot fallback**: when cursor-agent's print-mode MCP breaks
(a known, recurring community-reported issue), the user flips *that slot's* runner to
`cursor-ide` in config — the session model, the peer agent, the board, the prompts, everything
else is untouched. A vendor regression degrades one slot's launch convenience, never the system.

## Rules for adapter authors

1. Implement exactly `detect / configure / launch / stop` — resist adding runner-specific
   methods the CLI would have to know about.
2. `configure()` is idempotent — running `duo start` twice must not corrupt config files
   (merge into existing `mcp.json`s, never clobber user entries).
3. `launch()` returns a handle that lives until session end
   ([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md));
   premature exit must be reported, never swallowed.
4. Every known quirk gets: a `detect()`-time or launch-time check, a specific error message
   naming the fix, and a line in the adapter's header comment. Undocumented quirks are bugs.
5. Prompt *variants* (polling vs. held-call) are selected by the adapter but *defined* in the
   shared prompt builder — one source of truth for what agents are told.

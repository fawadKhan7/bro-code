# Decision: Long-Lived Agent Sessions

> **Hard invariant:** the agent process that plans is the agent process that codes. Planning and
> execution happen in one session, one context window, one process. Adapters return a handle
> that lives until session end — never a one-shot exec.

## The failure mode this prevents

A careless implementation of the planning protocol would double token costs:

```
BAD (two sessions)                        GOOD (one session)
──────────────────                        ─────────────────
spawn agent #1                            spawn agent (once)
  reads project map, explores               reads project map, explores
  writes plan                               posts plan
  exits ❌                                  blocks on await_plan_approval
user approves                             user approves
spawn agent #2                              tool returns {approved, edits}
  reads project map AGAIN                   continues coding immediately —
  explores AGAIN (cold context)             already knows the codebase ✅
  codes
```

The plan itself is cheap (~400 tokens of structured items). The waste in the bad flow is the
**second cold start**: the entire project context re-read and re-explored because the process
that had it was killed. The fix is not compressing the plan — it's never killing the process.

## Why planning and execution happen in the same session

1. **No repeated scans.** Exploration done during planning (opening the files the goal touches)
   is exactly the orientation execution needs. One process = paid for once.
2. **No context loss.** The agent's understanding of the codebase, the goal, and its own plan
   survives the approval gate intact — including nuances that never made it into the structured
   plan items.
3. **Prompt-cache economics.** Agent CLIs cache conversation prefixes; a live session continuing
   costs cached-rate tokens, while a fresh session re-reads everything at full rate.

## How the approval gate works without killing the process

The agent blocks **inside an MCP tool call**:

```
agent calls await_plan_approval(agent_id)
  → hub holds the HTTP response open (long-poll)
  → user runs `duo approve`
  → hub resolves every held call with { approved: true, edits: […] }
  → agent's tool call returns; it continues in the same turn
```

- **Timeout + retry:** held calls time out at a client-safe interval (e.g. 120s) returning
  `{ pending: true, retry: true }`; the kickoff instructs the agent to call again. Even the
  retry keeps the *process* alive — only the individual HTTP request cycles.
- **Polling fallback:** clients that handle held calls poorly (cursor-agent risk) get a kickoff
  that uses `get_plan_status` with instructed backoff instead. Same invariant — the process
  waits; it doesn't exit.

Execution checkpoints (`post_checkpoint` → `get_checkpoint_status`) follow the same pattern:
pause *inside* the session, never *by ending* it.

## What this demands from adapters

- `launch()` returns an `AgentHandle` whose process lives until `duo stop` or task completion —
  the adapter must configure its CLI for a full agentic run, not a single response
  (e.g. `claude -p` runs the agentic loop to completion; the handle watches for premature exit).
- **Premature exit is a failure signal.** If an agent process exits while it still holds claimed
  board items, the hub marks those items `open` again, emits a warning event, and the CLI offers
  a resume ([04-strategies-and-design-principles/failure-recovery.md](../04-strategies-and-design-principles/failure-recovery.md)).

## The exception: crash recovery

The *only* legitimate second-session case is an actual crash (process died, machine slept, MCP
detached). Then the replacement agent does **not** re-explore from scratch — it starts from
`get_resume_brief`: a condensed block of goal, board state, relevant contracts (with refs), and
the user's latest feedback ([03-core-concepts/resume-system.md](../03-core-concepts/resume-system.md)).
That brief is the cheap substitute for lost context — designed once, used only on failure paths.

## Net token accounting

Compared to the no-plan design: **+ one plan post (~400 tokens) + one held tool call**,
**− every token the old design spent on wrong-split rework** (building against a bad boundary,
re-integration, late discovery of env/DB/deploy work). Compared to a naive two-session plan
design: **− one full cold start per agent per session** — the dominant term by far.
Full strategy: [04-strategies-and-design-principles/token-efficiency.md](../04-strategies-and-design-principles/token-efficiency.md).

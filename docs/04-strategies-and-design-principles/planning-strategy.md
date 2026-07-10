# Strategy: Planning

> Why work division is decided by agents at runtime, gated by a human, and expressed as
> structured data — and why planning must never grow into a second development task.

## Why static role splitting fails

A preset split ("A=Frontend, B=Backend") is decided **before any intelligence has seen the goal
or the code**. Its two failure modes:

1. **Dropped cross-cutting work.** "Add Google OAuth login" requires UI *and* API *and* env
   vars *and* a DB migration *and* deployment secrets. The template covers the first two;
   the rest silently belong to no one.
2. **Wrong shapes.** backend+backend, mobile+backend, service+service — real pairings don't fit
   a frontend/backend enum, and enumerating presets for every pairing is a treadmill.

The orchestrator cannot fix this itself without violating the zero-API-key constraint. The
agents can: they're LLMs *with the codebase open*. So the split becomes their first deliverable,
and the preset is demoted to a default bias
([03-core-concepts/presets.md](../03-core-concepts/presets.md)).

## Why planning happens before execution

Cost asymmetry. A wrong division costs almost nothing at minute 2 (edit a proposed board) and
enormously at minute 40 (two agents built against a wrong boundary; integration rework; late
discovery of unowned work). The plan checkpoint moves the correction to the cheap end.
One round-trip (~400 tokens) insures against 100× that in rework.

## Why plans are structured data, not essays

Because **the schema is the only reliable way to bound LLM verbosity.** If `post_plan` accepted
prose, some fraction of plans would become design documents — expensive to write, expensive for
the human to review, and instantly stale. So:

- `post_plan` accepts **only** `{ title: 1 line, ownerHint, paths[] }`, hard cap ~15 items.
- There is deliberately **no description field**.
- Interface details are *excluded by design*: they're decided during execution via
  `post_contract`, by the owning agent, when the item is actually reached — later means
  better-informed, and contracts are versioned where plan prose would rot.

The plan answers exactly three questions: *what work exists? who does each piece? which files?*
Everything else is execution.

## Fast paths for simple tasks

Two, layered so the common case needs no flags:

1. **Trivial-plan auto-approve** (default on, configurable): merged plan ≤2 items, all cleanly
   owned, none unassigned → hub approves without waiting. The human still sees it in the log.
2. **`--no-plan`**: skips the phase entirely; the board is pre-filled from the preset
   (mechanics: [02-architecture-upgrade/06-planning-protocol.md](../02-architecture-upgrade/06-planning-protocol.md)).
   For when the user *knows* the division ahead of time.

## Human approval rules

- Plan approval is **required** whenever the merged plan has >2 items, any unassigned item, or
  any conflict between the two proposals.
- The human can: approve as-is, reassign owners, add/remove items, mark items out-of-scope, or
  send the plan back with feedback for one more planning round.
- **Unassigned items block approval** — the CLI forces a decision (`--assign tN=X` or
  out-of-scope). This is where env/deploy/shared work gets an explicit owner, on purpose, every
  time.
- Approval happens while agents are blocked on held tool calls — never while they're already
  coding ([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md)).

## Anti-goals (reject in review)

- Plans with prose fields, nested subtasks, or estimates — scope creep toward project-management
  theater.
- The hub "improving" plans with heuristics beyond merge/de-dup — intelligence belongs to agents
  and the human.
- A planning phase that re-runs on every checkpoint — the plan is authored once; the *board*
  evolves (items added via checkpoint conversations if genuinely discovered mid-task).

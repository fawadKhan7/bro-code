# Strategy: Human in the Loop

> Two autonomous agents multiply both productivity and blast radius. The human is not a
> spectator — they are a designed component with three specific decision points, placed where
> human judgment is cheapest and most valuable.

## The three gates

| Gate | When | Human decides |
|---|---|---|
| **Plan approval** | After agents propose, before any code | Is the division right? Who owns the unassigned items? Anything missing/out of scope? |
| **Checkpoints** | At milestones / before risky actions (checkpoint mode) | Continue, or adjust course with feedback |
| **Completion arbitration** | End of session | Only a human can mark board items `out-of-scope` — agents cannot silently shrink the goal |

Everything else is deliberately *not* gated: file edits, tool calls, contract posts. Gating those
would make the human a bottleneck for exactly the work they delegated.

## Why each gate sits where it does

- **Plan approval** exploits the cost asymmetry: a wrong division costs an edit at minute 2 and
  hours of rework at minute 40 ([planning-strategy.md](planning-strategy.md)). It's also where
  cross-cutting items (env, deploy) get an explicit owner — the human decision the old
  architecture never asked for, which is why work got dropped.
- **Checkpoints** exist because agents compound errors confidently. A pause after each major
  feature bounds the maximum wasted work to one feature's worth
  ([03-core-concepts/checkpoints.md](../03-core-concepts/checkpoints.md)). Mode is chosen per
  session: `checkpoint` for consequential work, `auto-run` for low-risk tasks.
- **Completion arbitration** closes the loop-hole where an agent "finishes" by ignoring the hard
  parts: the completion rule + human-only `out-of-scope` makes goal-shrinking an explicit,
  logged human decision.

## Feedback as a first-class channel

Approval is binary; feedback is where the human actually steers:

- Plan phase: `duo feedback "split t2 — token handling should be its own item, owned by A"`
  → agents revise, one more round.
- Checkpoints: `duo feedback --agent B "use the secrets manager, not .env"` → agent adjusts
  and continues *in the same session*, with the feedback also embedded in the next resume brief
  so it survives restarts ([03-core-concepts/resume-system.md](../03-core-concepts/resume-system.md)).

## Ergonomics rules (or the gates get bypassed)

A gate the user hates is a gate the user disables — so gates must be cheap to operate:

- **Interruptions are pushed, not polled**: pending approvals surface in `duo status --watch`,
  the dashboard, and a terminal bell/notification — the human should never babysit.
- **Reviews are compact**: plans are ≤15 one-line items; checkpoints are two lines
  (done / next). The structured-data rule exists partly *for the reviewer*.
- **Decisions are one command**: `duo approve`, `duo approve --assign t5=B`,
  `duo feedback "…"`.
- **Trivial cases self-approve**: the ≤2-item fast path keeps the gate from taxing small tasks
  (configurable off for users who want to see everything).

## What the human is trusted with vs. what the system enforces

| Human judgment | System enforcement |
|---|---|
| Is this plan right? | Plans can't be executed without approval (phase gate) |
| Is this direction right? (checkpoint) | Agents block until resolved — can't skip the gate |
| Is this item out of scope? | Agents cannot set that status; sessions can't end with open items |
| Which mode fits this task? | Mode is honored mechanically (checkpoint prompts + tools) |

The philosophy in one line: **autonomy between gates, human authority at gates, and the gates
placed only where a wrong autonomous decision is expensive to undo.**

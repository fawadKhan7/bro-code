# Concept: Checkpoints

## What it is

A checkpoint is a deliberate pause: an agent stops before/after something significant, reports
what it did and what it intends next, and waits for human approval or feedback — **without its
process exiting**.

## Why it exists

Autonomous agents working in parallel multiply both productivity and blast radius. Checkpoints
are the human's brake and steering wheel: catch a wrong direction after one feature, not after
forty minutes of compounded work; inject course corrections ("looks good, but use httpOnly
cookies, not localStorage") while context is still cheap to adjust. Strategy-level discussion:
[human-in-the-loop.md](../04-strategies-and-design-principles/human-in-the-loop.md).

## How it works

```
agent: post_checkpoint(agent_id, summary: "Auth API done, tests green",
                       next_step: "Wire Google credentials into deploy config")
       → status: pending — hub emits event, CLI/dashboard show a review card
agent: get_checkpoint_status(agent_id)      ← held/polled, process stays alive
user:  duo approve            → { status: "approved" }            agent continues
   or: duo feedback "use secrets manager, not env file"
                              → { status: "feedback", feedback: "…" }
                                agent adjusts, then proceeds
```

- **Two session modes** (from generation 1): `auto-run` (no mid-task pauses) and `checkpoint`
  (pause at milestones / before irreversible actions). Mode is set at `duo start` and stated in
  the kickoff.
- **`why` / `impact` (v2)** — a checkpoint carries, in plain non-engineer language, *why the agent
  is pausing / what your approval means* (`why`) and *what happens if you approve* (`impact`). The
  dashboard renders them as "Why it's asking:" / "If you approve:" so the user understands the
  decision, not just the action.
- **`kind: "question"` (v2)** — the agent can pause purely to *ask* the user something, taking no
  action until the answer arrives via feedback. The dashboard shows an "asks:" card with a "Send
  answer" box; the agent reads the answer through `get_checkpoint_status` (status `feedback`) and
  proceeds. This is the "ask a question before approving" loop — one channel, no new machinery.
  See [../05-implementation-plan/phase-05-legible-contracts-and-approvals.md](../05-implementation-plan/phase-05-legible-contracts-and-approvals.md).
- **Plan approval is a checkpoint** — the same machinery gates the transition from planning to
  executing ([planning-phase.md](planning-phase.md)).
- **Resume includes a brief**: on approval after feedback, the agent gets a condensed context
  block rather than re-deriving state ([resume-system.md](resume-system.md)).
- Waiting uses the same held-call/polling pattern as plan approval — pause happens *inside* the
  session, never by ending it
  ([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md)).

## How it interacts with other components

- **CLI** surfaces pending checkpoints in `duo status` and resolves them via
  `duo approve` / `duo feedback` (REST → hub → held MCP call resolves).
- **Dashboard** shows review cards with approve/feedback buttons — same REST endpoints.
- **Task board**: checkpoints are also where agents ask the human to mark stuck items
  out-of-scope ([task-board.md](task-board.md)).

## Example (checkpoint mode, two agents)

```
$ duo status
Agent A  [Frontend/cursor-cli]   working    t1 claimed
Agent B  [Backend/claude-code]   ⏸ CHECKPOINT pending
   done: OAuth callback + token issuance implemented, 12 tests green
   next: run users.google_id migration on the dev database

$ duo feedback --agent B "run it, but add a rollback file first"
```

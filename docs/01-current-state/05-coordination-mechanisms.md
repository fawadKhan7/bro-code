# Current Coordination Mechanisms

> The primitives that let two agents work in parallel without stepping on each other:
> contracts, the arming handshake, checkpoints, logs, and workspace files.
> These are the **proven core** of the project — the upgrade keeps all of them.

## 1. Contracts — the dependency solver

A **contract** is a plain-text message one agent posts so the other can integrate against it:
API endpoint shapes, file formats, DB schemas, TypeScript interfaces, shared constants.

Contracts solve the dependency problem **without polling**: Agent B posts the API contract as
soon as the shape is *decided* (even before it's implemented); Agent A calls `get_contracts`
once, when it actually needs to integrate — the data is already there.

Generation 1 implementation (`src/contractDisk.ts` + `src/mcpServer.ts`):

- **`contentHash`** — SHA-256 of the content; detects drift across sessions.
- **`revision`** — monotonic counter per `service` slug within a session.
- **Disk mirror** — every `post_contract` *prepends* a revision block to
  `contracts/<service>.md` in the poster's workspace. One slug per file → fewer git merge
  conflicts than a single shared file; auditable in git; CI-checkable via
  `scripts/check-contracts.mjs`.
- **Service slug** — from the `service` argument or a `service: slug` line inside the content.

Generation 2 additions (Conductor): **versioned updates with `sinceVersion` delta reads**, and
**`refs: string[]`** — file paths instead of code, so no source travels over MCP.

## 2. The arming handshake — agent synchronization

Problem: both chat sessions are started by a human at slightly different moments; an agent that
gets its task immediately might finish designing an interface before its peer even exists.

Solution (generation 1, `get_my_task`): after tasks are set, both agents are *disarmed*. The
first `get_my_task` call from each chat marks that agent armed, but returns
`{ waiting: true, message: "…waiting for Agent B…" }` until **both** are armed. Only then does
`get_my_task` return the full task payload. The panel/terminal shows arming state live
(`armedA`, `armedB`, `sessionReady`).

## 3. Checkpoints — human-in-the-loop pauses

In **checkpoint mode**, agents pause before major or irreversible actions:

```
agent: post_checkpoint(agent_id, summary, next_step)   → status: pending
user:  panel card / control terminal → Approve  or  Give Feedback
agent: get_checkpoint_status(agent_id)                 → approved | feedback (+ text)
```

Conductor extends this with the **resume brief**: on approval, a condensed context block
(goal, feedback, contract state) is generated so the agent resumes from a clean summary instead
of a bloated history (see [03-core-concepts/resume-system.md](../03-core-concepts/resume-system.md)).

## 4. Progress logs

`post_update(agent_id, message)` appends to an in-memory log, pushed live over SSE to every
panel/terminal. This is the human's window into what both agents are doing without reading
either chat. Conductor structures updates further (type, summary, diff, refs).

## 5. Workspace files — persistent, git-visible context

| File | Written by | Purpose |
|---|---|---|
| `TASKS.md` | task assignment (`src/taskFileWriter.ts`) | Full task text in the workspace root — survives chat restarts |
| `contracts/<service>.md` | every `post_contract` | Disk mirror of contracts (revision blocks, newest first) |
| `.cursor/rules/duo-protocol.mdc` | "Install Protocol Rules" command | Protocol instructions generated from the live tool catalog |
| `.cursor/rules/conductor-agent-{a,b}.mdc` | `conductor start` | Injected brief + project map (removed on next start/stop) |
| `duo-digest.md` | `npm run digest` | Optional path-only repo listing for orientation |

## 6. Modes

- **Auto-run** — agents work to completion without stopping.
- **Checkpoint** — agents pause at milestones for approval (mechanism above).

## What changes in the upgrade

All six mechanisms survive. The changes are structural, not conceptual:

| Today | After upgrade |
|---|---|
| Two static tasks (`taskA`/`taskB`) | Shared **task board** with claims ([02-architecture-upgrade/05-task-board-model.md](../02-architecture-upgrade/05-task-board-model.md)) |
| Arming handshake for 2 agents | Same handshake generalized to N agents + **plan phase** gate ([02-architecture-upgrade/06-planning-protocol.md](../02-architecture-upgrade/06-planning-protocol.md)) |
| `get_contracts` returns everything | `sinceVersion` deltas everywhere (from Conductor) |
| Checkpoint approval via panel | Same via `duo approve` / dashboard; plus the plan-approval checkpoint |

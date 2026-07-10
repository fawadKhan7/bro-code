# Concept: Task Board

## What it is

The task board is the hub-owned list of work items for the session — each with a title, file
paths, an owner hint, a claimant, and a status (`open → claimed → done`, or `out-of-scope`).
It replaces the old fixed `taskA`/`taskB` pair.

## Why it exists

Three reasons, in order of importance:

1. **Dropped-work detection.** Cross-cutting items (env vars, migrations, deployment) become
   visible rows that *must* be resolved — the hub refuses session completion while anything is
   open or claimed. Silent omission becomes structurally impossible.
2. **Flexible splits.** Ownership is claimed at runtime under plan guidance, not frozen at start
   by a template. backend+backend or mobile+backend splits need no special support.
3. **N-agent scaling.** A board with claims works identically for 2 or 5 agents; two task
   strings never would.

## How it works

Item shape and lifecycle: see the authoritative spec in
[02-architecture-upgrade/05-task-board-model.md](../02-architecture-upgrade/05-task-board-model.md).
The essentials:

- **Populated** by agent `post_plan` proposals (merged by the hub, approved by the human) — or
  pre-filled from the preset in `--no-plan` mode.
- **Claims are validated**: an item's `paths` must fall inside the claimant's workspace;
  unclear items stay unassigned until the human assigns them at plan approval.
- **Versioned**: every change bumps `boardVersion`; agents read deltas with
  `get_board(since_version)` — never the whole board twice.
- **Completion rule**: `complete_task` fills `refs` (file pointers for the peer); the session
  can end only when every item is `done` or human-marked `out-of-scope`.

## How it interacts with other components

- **Planning phase** ([planning-phase.md](planning-phase.md)) authors it.
- **Contracts** ([contracts.md](contracts.md)) complement it: the board tracks *work*, contracts
  record *interfaces* the work produces.
- **CLI/dashboard** render it (`duo plan`, `duo status`, board view) and edit it (approve,
  reassign, out-of-scope).
- **Failure recovery**: a crashed agent's claimed items revert to `open` for re-claiming
  ([failure-recovery.md](../04-strategies-and-design-principles/failure-recovery.md)).

## Example

After plan approval for *"Add Google OAuth login"*:

| id | title | ownerHint | claimedBy | status | paths |
|---|---|---|---|---|---|
| t1 | Google OAuth consent screen + login button | A | A | claimed | web/src/pages/login/* |
| t2 | `/auth/google` + callback route, token issuance | B | B | claimed | api/src/auth/* |
| t3 | `users.google_id` migration | B | — | open | api/migrations/* |
| t4 | GOOGLE_CLIENT_ID/SECRET env docs + .env.example | B | — | open | api/.env.example, README |
| t5 | Update deploy config with new secrets | — (human assigned: B) | — | open | infra/* |

t3–t5 are exactly the items a static frontend/backend split would have dropped.

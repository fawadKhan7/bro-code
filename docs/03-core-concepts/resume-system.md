# Concept: Resume System

## What it is

The resume system produces a **resume brief**: a condensed, hub-generated context block — goal,
board state, agreed contracts (with refs), latest human feedback — that replaces history replay
whenever an agent continues after an interruption. Fetched via the `get_resume_brief(agent_id)`
tool. Originates in Conductor ([`conductor/shared/src/resumeBrief.ts`](../../conductor/shared/src/resumeBrief.ts)).

## Why it exists

Two situations threaten either correctness or token budgets:

1. **Checkpoint resume with feedback** — the agent should act on the feedback with clean,
   current state, not re-derive it from a long conversation.
2. **Crash / restart** — the *only* legitimate case where an agent process is replaced
   ([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md)).
   Without a brief, the replacement would cold-start: full re-scan, full re-exploration —
   exactly the double-cost failure the architecture forbids.

Because the hub is the source of truth, everything a brief needs already exists in one place —
generating it is pure logic, zero LLM.

## How it works

Brief contents (assembled by the hub on demand):

```
# Resume Brief — Agent B (Backend) — v3
Goal: Add Google OAuth login
Phase: executing   Mode: checkpoint

Your board items:
  t2 claimed  /auth/google + callback route      api/src/auth/*
  t3 open     users.google_id migration          api/migrations/*

Contracts in force:
  auth-api rev2 (sha256:9f2c…) → contracts/auth-api.md, refs: api/src/auth/auth.controller.ts

Peer status: Agent A completed t1 (refs: web/src/pages/login/LoginPage.tsx)

Latest human feedback: "add a rollback file before running the migration"
```

- **Versioned** (`resumeBriefVersion`) — regenerated on each checkpoint resolution and on
  demand; an agent can detect it already has the latest.
- **Refs, not code** — like contracts, the brief points at files; the agent reads what it needs.
- **Crash flow:** the CLI relaunches via the adapter with a *resume kickoff* — a shortened
  prompt whose first instruction is `get_resume_brief` — instead of the full exploratory
  kickoff. Claimed items released by the crash are visible as `open` again.

## How it interacts with other components

- **Checkpoints** ([checkpoints.md](checkpoints.md)) trigger regeneration; feedback lands here.
- **Task board / contracts** are its data sources — the brief is a *view*, never a second copy
  of truth ([state-management.md](../04-strategies-and-design-principles/state-management.md)).
- **Failure recovery** ([failure-recovery.md](../04-strategies-and-design-principles/failure-recovery.md))
  is its main consumer.

## Example

```
$ duo status
Agent B: process exited unexpectedly (claimed items released: t2)
$ duo resume B
Relaunching Agent B (claude-code) with resume brief v3 … registered ✓
```

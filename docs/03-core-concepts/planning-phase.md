# Concept: Planning Phase

## What it is

The first phase of every session (unless `--no-plan`): agents explore their workspaces, propose
a structured work breakdown (`post_plan`), the hub merges the proposals into one task board, and
the human approves it before any code is written.

## Why it exists

Static role presets guess the work division before any intelligence has seen the task — and real
goals cut across boundaries (env vars, migrations, deployment) that templates drop. The agents
are the only LLMs in the system (zero-API-key constraint), and they're the only participants who
have the codebase open — so *they* author the plan, and the human arbitrates. Full rationale:
[02-architecture-upgrade/06-planning-protocol.md](../02-architecture-upgrade/06-planning-protocol.md).

## How it works

1. Kickoff instructs: explore, then `post_plan` with **items only** — `{ title, ownerHint,
   paths[] }`, ≤15 items, no prose. Include *everything* (code, env, DB, deploy); leave unclear
   items unassigned.
2. Hub merges both agents' proposals (title/path similarity de-dup — pure logic, no LLM),
   flags overlaps and unassigned items.
3. Agents block on `await_plan_approval` — a held tool call; the **process stays alive**, its
   context warm ([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md)).
4. Human: `duo plan` (review) → `duo approve` (accept), `duo approve --edit` (reassign / add /
   remove / mark out-of-scope), or `duo feedback "…"` (one more planning round).
5. Held calls resolve with `{ approved, edits }`; phase flips to `executing`; the same agent
   processes continue.

**Fast path:** a merged plan of ≤2 cleanly-owned items auto-approves (configurable off) — trivial
tasks don't wait for a human.
**Skip:** `--no-plan` starts directly in `executing` with a preset-derived board.

## How it interacts with other components

- Produces the **task board** ([task-board.md](task-board.md)).
- Is the first **checkpoint** — same approval machinery, surfaced in CLI and dashboard.
- Consumes the **project map** ([project-scanner.md](project-scanner.md)) so exploration is
  targeted, not a crawl.
- Sets up **contracts** implicitly: items whose interfaces matter get contracts during
  execution, not paragraphs in the plan.

## Example

```
$ duo plan
Session: "Add Google OAuth login"   phase: planning (awaiting approval)

Merged board (5 items, 1 unassigned, 0 conflicts):
  t1  [A]  Google OAuth consent screen + login button      web/src/pages/login/*
  t2  [B]  /auth/google + callback route, token issuance   api/src/auth/*
  t3  [B]  users.google_id migration                       api/migrations/*
  t4  [B]  GOOGLE_CLIENT_ID/SECRET env + .env.example      api/.env.example
  t5  [—]  Update deploy config with new secrets           infra/*        ← needs owner

$ duo approve --assign t5=B
Plan approved. Agents resuming (phase: executing).
```

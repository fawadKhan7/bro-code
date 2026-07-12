# Phase 5 — Legible Contracts & Understandable Approvals

> v2 begins here. Driven by first real-user feedback (2026-07): contracts read as foggy blobs,
> and approval requests don't explain what the user is actually deciding.

## Goal

Every contract answers "what was decided?" in one plain sentence, every approval card answers
"what am I approving and what happens if I do?", and the user can **ask the agent a question**
before deciding — all rendered in the existing dashboard (and later the desktop app, phase 7).

## Why this phase exists

The v1 protocol was designed for agent-to-agent efficiency: contracts are freeform text,
checkpoints carry two terse engineer-to-engineer lines (`summary`, `next_step`). Real use showed
the *human* is a first-class reader of both, and v1 gives them nothing written for a human.
This phase runs first in v2 because it is small, has zero architecture risk, and phases 6–7
render these same cards — building the GUI on top of illegible data would bake the problem in.

## Scope

**In:** schema additions (below), prompt-builder updates + goldens, dashboard card redesign,
the ask-a-question loop, fake-agent coverage for new fields.
**Out:** any session-lifecycle change (phase 6), the desktop shell (phase 7).

## Schema changes (additive — old agents keep working)

| Tool | Change | Purpose |
|---|---|---|
| `post_contract` | + `summary: string` (required for new kickoffs; one sentence, plain language) | The headline: *"Login returns a JWT plus the user's id and email."* |
| `post_checkpoint` | + `why: string` (why I'm pausing — what your approval means) and `impact: string` (what happens if you approve) | The approval card explains itself |
| `post_plan` | + `plan_summary: string` (≤ ~300 chars) | Human-readable digest above the item list: *"I'll scaffold the React app, build login against B's auth API, then the feed UI."* |

Deliberate rule-bend, recorded: plans stay structured items —
[planning-strategy.md](../04-strategies-and-design-principles/planning-strategy.md)'s "no prose"
rule gets exactly one bounded exception (`plan_summary`), written for the human reviewer, capped
so it cannot become a design essay.

## Prompt changes (golden-file tracked)

1. Contract instruction gains a fixed body shape: **What was decided / The interface / Example** —
   plus the required one-sentence `summary` (non-engineer phrasing).
2. Checkpoint instruction requires `why` + `impact`, phrased for a non-engineer.
3. Plan instruction requires `plan_summary`.
4. **The Q&A loop:** *"If checkpoint feedback is a question, answer it by posting a new
   checkpoint containing the answer — take no other action until approved."*

## Dashboard changes

- **Contract cards**: summary as headline; body collapsed; per-service latest revision with an
  inline **diff vs the previous revision** (line-level; no library beyond a small differ).
- **Checkpoint cards**: `Agent B finished: … / Wants to do next: … / Why it's asking: … /
  If you approve: …` + three buttons: **Approve · Ask a question · Give feedback** (Ask = the
  feedback channel with question framing; the loop closes via the prompt rule above).
- **Plan review**: `plan_summary` per agent rendered above the item table; unassigned-item
  explanation text ("these need an owner because neither agent claimed them").

## Implementation steps

1. Store + tool schemas: new fields, validation, persistence (hub).
2. Prompt builder: the four instruction changes; regenerate goldens (reviewed diff).
3. Dashboard: contract cards + diff, checkpoint cards, plan summary, Ask-a-question button.
4. Fake-agent scenarios: new fields round-trip; a scripted Q&A loop (question → answering
   checkpoint → approve); old-style calls (missing new fields) still accepted.
5. `REAL-RUNS.md` entry: one live session confirming agents actually fill the fields usefully —
   the real risk in this phase is prompt compliance, not code.

## Risks

| Risk | Mitigation |
|---|---|
| Agents write engineer-speak in `why`/`summary` anyway | Prompt phrasing is golden-tracked and iterated against real runs; the schema descriptions carry the "plain language" nudge (schema beats prose) |
| `plan_summary` bloats | Hard cap in schema; hub truncates |
| Old sessions/agents lacking fields break the UI | UI renders every new field as optional; fake-agent test pins it |

## Acceptance criteria

1. A live session's dashboard shows: plan summaries above items, contract headlines + a working
   rev-diff, checkpoint cards with why/impact.
2. Ask-a-question round-trip works live: user asks, agent answers via a new checkpoint without
   acting, user approves.
3. Tokenless suite green, incl. new-field round-trips and legacy-call compatibility.

## Definition of Done

Acceptance run recorded in `REAL-RUNS.md`; goldens reviewed; concept docs
([contracts.md](../03-core-concepts/contracts.md), [checkpoints.md](../03-core-concepts/checkpoints.md),
[planning-phase.md](../03-core-concepts/planning-phase.md)) updated to describe the new fields.

# Concept: Presets

## What it is

A preset is a static template pair that seeds each agent's **role** and **focus text** from a
single goal — with zero LLM calls. Implementation exists at
[`conductor/shared/src/presets.ts`](../../conductor/shared/src/presets.ts) (ported in phase 1).

Shipped presets: `frontend-backend`, `builder-reviewer`, `architect-implementer`,
`feature-tests`, `service-ab`, and `custom` (user-defined role strings).

## Why it exists

The kickoff prompt needs *some* initial role framing, and the orchestrator can't generate it
with an LLM (zero-API-key constraint). Presets are the cheap, predictable answer: template
expansion the user can read, trust, and override.

## Demoted by design: bias, not cage

In the old architecture the preset *was* the work split — its guess was final, which is why
rigid splitting was a core weakness
([01-current-state/06-strengths-and-weaknesses.md](../01-current-state/06-strengths-and-weaknesses.md)).
In the new architecture the **plan decides the split**
([planning-phase.md](planning-phase.md)); the preset only:

1. Seeds the role line and focus paragraph of the kickoff prompt.
2. Provides `ownerHint` defaults when merging plan proposals.
3. Generates the fallback board in `--no-plan` mode.

Kickoff wording changes accordingly — from "Focus: X" (reads as a wall) to:
*"Your primary responsibility is X. This is a starting bias, not a boundary — if the plan
surfaces work outside it that lives in your workspace, claim it."*

Roles are **free-form strings**, not an enum — `"Billing service backend"`, `"Mobile app"`,
`"Test writer"` all work; presets are just convenience fills for common pairs. This is what
makes backend+backend or mobile+backend sessions ordinary configuration.

## How it works

```
buildBriefs("Add Google OAuth login", "frontend-backend")
  ↓ pure template expansion
briefA: Role: Frontend
        Shared goal: Add Google OAuth login
        Primary responsibility: UI, client flows, forms, routing, browser token
        storage. Bias, not boundary. Use get_contracts before integrating APIs…
briefB: Role: Backend
        Primary responsibility: routes, auth, persistence, server validation.
        Publish endpoint shapes early via post_contract…
```

Explicit per-agent briefs bypass presets entirely:

```bash
duo start --agent-a "Login/signup UI with token refresh" \
          --agent-b "JWT auth API: /login /register /refresh"
```

## How it interacts with other components

- **Prompt builder** consumes the brief as one block of the kickoff ([agent.md](agent.md)).
- **Planning phase** consumes `ownerHint` defaults and overrides everything else.
- **CLI**: chosen at `duo init` (default) or per-session `--preset`; `custom` roles are stored
  in config.

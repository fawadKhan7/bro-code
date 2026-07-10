# Strategy: Token Efficiency

> The orchestrator spends zero tokens (no LLM calls). Every token in the system is spent by the
> agents — on the user's subscription. This strategy exists so the *architecture* never forces
> agents to waste them.

## Why token usage matters

Agents run on the user's Cursor/Claude plans with rate limits and usage caps. A wasteful
architecture doesn't just cost money — it exhausts caps mid-task and slows every turn (bigger
context = slower responses). Multi-agent setups double every inefficiency by construction, so
discipline here decides whether the product is usable at all.

## The central rule

**The most expensive event in the system is an agent cold start** — a fresh process re-reading
and re-exploring a codebase it (or its predecessor) already knew.

```
BAD                                     GOOD
───                                     ────
Agent restarts                          Agent stays alive
    ↓                                       ↓
Reads project again                     Keeps context
    ↓                                       ↓
Consumes tokens (full rate,             Continues execution (incremental
full re-exploration)                    tokens, prompt-cache rates)
```

Everything below is a corollary of avoiding cold starts or shrinking what crosses the wire.

## The techniques

| # | Technique | Mechanism |
|---|---|---|
| 1 | **Keep agent sessions alive** | One process spans plan → approve → execute; approval gates are held tool calls *inside* the session, never process exits ([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md)) |
| 2 | **Scans instead of AI exploration** | The regex project map (zero tokens to produce) is injected at kickoff, pre-paying orientation ([03-core-concepts/project-scanner.md](../03-core-concepts/project-scanner.md)) |
| 3 | **Structured plans, not essays** | `post_plan` schema is items-only (title/owner/paths, ≤15) — there is no field an agent *could* bloat ([planning-strategy.md](planning-strategy.md)) |
| 4 | **Delta updates** | `get_board(since_version)`, `get_contracts(since_version)` — state already seen is never re-sent |
| 5 | **State lives in the hub, not in prompts** | Board, contracts, checkpoints are fetched on demand; kickoff prompts carry protocol + orientation, not data that will change |
| 6 | **Contracts instead of conversation** | Compact versioned facts posted once, read once — vs. two LLMs re-explaining context to each other |
| 7 | **Refs, not code** | MCP messages carry file paths; agents read files locally (cheaper, always current) |
| 8 | **No polling by instruction** | Kickoffs say when to check contracts (at integration time), checkpoints use held calls, the arming gate replaces "is my peer ready?" loops |
| 9 | **Resume briefs on failure paths** | A crash costs one condensed brief, not a full re-scan ([03-core-concepts/resume-system.md](../03-core-concepts/resume-system.md)) |

## When to use `--no-plan`

The plan round-trip costs roughly one plan post (~400 tokens) plus a held call. Skip it when the
split is trivially obvious and rework risk is near zero:

- Tightly-scoped fixes ("fix the typo on the login page", "bump the dependency in both repos")
- Tasks with an inherently obvious division that matches the preset exactly
- Re-runs where the division was already settled in a previous session

Don't skip it for anything cross-cutting (auth, payments, deployments, schema changes) — the
plan is the cheapest insurance in the system: one wrong-split integration rework costs 100×
what planning does. The trivial-plan fast path (≤2 cleanly-owned items auto-approve) usually
makes explicit `--no-plan` unnecessary.

## Accounting example (rough orders of magnitude)

| Event | Naive design | This design |
|---|---|---|
| Orientation | agent explores repo: 5–20k tokens | injected map: ~1–2k tokens in prompt |
| Plan → execute | second cold start: repeat orientation + exploration | 0 (same process) |
| Peer sync | poll `get_contracts` every turn: full list each time | 1 delta read at integration time |
| Checkpoint resume | replay history | resume brief: ~300–600 tokens |

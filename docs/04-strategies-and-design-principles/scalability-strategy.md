# Strategy: Scalability

> Ship for 2 agents; design so N agents, new role shapes, and new AI providers are configuration
> and thin modules — never rewrites. The previous generations hard-coded the pair everywhere;
> we don't repeat that.

## The lesson being corrected

`AgentId = "A" | "B"` leaked into state shapes (`Record<AgentId, …>`), tool schemas, REST
payloads, and UI in *both* previous generations
([01-current-state/06-strengths-and-weaknesses.md](../01-current-state/06-strengths-and-weaknesses.md)).
Going from 2 to 3 agents would have been a rewrite. The root cause: the pair was a *type*, not
*data*.

## Supporting 2 agents initially — but as a list

From day one of phase 1:

- Session state holds `agents: AgentConfig[]` — never an A/B record.
- Tools take `agent_id: string`, validated against the registered list.
- "The peer" is computed (`agents.filter(a => a.id !== me)`), not assumed singular — prompt
  builder, resume briefs, and status views all iterate.
- The **CLI** enforces `agents.length === 2` in v1 — scaling limits live in the UX layer
  (where relaxing them is cheap), never in the hub or state model.

## Moving to N agents

What already scales by construction, given the above:

| Mechanism | Why it's N-ready |
|---|---|
| Task board | Claims are per-item; more agents = more claimants ([02-architecture-upgrade/05-task-board-model.md](../02-architecture-upgrade/05-task-board-model.md)) |
| Plan merge | Merging k proposals is the same operation as merging 2 |
| Registration handshake | "All registered" is a count over the list (gen 1's arming, generalized) |
| Contracts | Already many-to-many (posted by anyone, read by anyone) |
| Hub topology | Star — each new agent is one more MCP client |
| Adapters | Per-slot; N slots = N launches |

What genuinely needs work at N>2 (deferred, documented so nobody "solves" it prematurely):
approval UX (k plan proposals to review), log legibility, and checkpoint storms (several agents
pausing at once). These are v2 UX problems, not architecture problems.

## Dynamic roles

Roles are free-form strings used as planning biases
([03-core-concepts/presets.md](../03-core-concepts/presets.md)) — so new team shapes
(backend+backend, mobile+backend, builder+reviewer+tester) are config entries, not features.
Presets remain a convenience layer; nothing validates against a role enum anywhere.

## Task ownership & workspace boundaries at scale

The two-rule system is deliberately scale-free:

1. **Hard rule:** claims validated against the claimant's workspace paths — mechanical, works
   identically for 2 or 10 agents ([03-core-concepts/workspaces.md](../03-core-concepts/workspaces.md)).
2. **Soft rule:** `ownerHint` biases from roles — advisory at any N.

Shared-file hotspots (root configs, shared type packages) are handled the same way at any scale:
made explicit as board items with exactly one owner at plan approval.

## Future AI providers

The adapter interface (`detect/configure/launch/stop`) is the extension point: one new file per
provider, no hub/CLI/protocol changes
([02-architecture-upgrade/04-adapter-architecture.md](../02-architecture-upgrade/04-adapter-architecture.md)).
Providers without headless CLIs get manual (clipboard) adapters like `cursor-ide`.

## Explicit non-goals

Cross-machine sessions, multiple concurrent sessions per machine, and agent hierarchies
(orchestrator-agents managing sub-agents) — all excluded from v1. The state model doesn't
preclude them; the scope does.

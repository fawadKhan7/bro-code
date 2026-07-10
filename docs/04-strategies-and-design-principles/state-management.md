# Strategy: State Management

> One writer, one truth, write-through persistence, versioned reads. Every state bug in the
> previous generations traces to violating one of these; the new system makes them structural.

## The four rules

### 1. The hub is the only writer

All session state — board, contracts, checkpoints, logs, phase, registrations — mutates in
exactly one process, through tool/REST handlers that run on Node's single-threaded event loop.
No locks needed, no lost updates possible. This is the direct fix for Conductor's fatal flaw
(N processes doing read-modify-write on a shared JSON file
— [01-current-state/03-conductor-prototype.md](../01-current-state/03-conductor-prototype.md)).

### 2. Memory is authoritative; disk is write-through persistence

State lives in hub memory and is flushed to `~/.duo/session.json` after every mutation, before
the mutating call returns. The file is a **crash-recovery artifact, never a coordination
channel** — nothing else reads it while the hub runs, and nothing but the hub ever writes it.

```
tool call → validate (phase, ownership) → mutate memory → persist → emit SSE → return
```

A hub restart is therefore lossless: load file → resume phase → agents' next calls just work
([failure-recovery.md](failure-recovery.md)).

### 3. Every read surface is versioned

`boardVersion`, `contractVersion`, `resumeBriefVersion` — monotonic counters bumped on change.
Consumers (agents via `since_version` tool params, dashboard via SSE event versions) fetch
deltas and can always cheaply answer "am I stale?". This is the token-efficiency backbone
([token-efficiency.md](token-efficiency.md)) and also what makes reconnects trivial: a client
that was away just asks for everything since its last version.

### 4. Views are computed, never stored

Resume briefs, status summaries, `duo plan` renderings, dashboard panels — all derived from the
canonical state on demand. Nothing is stored twice, so nothing can disagree. (The one deliberate
exception: contract **disk mirrors** in workspaces are a write-once export for git/CI
consumption — append-only, never read back by the hub
— [03-core-concepts/contracts.md](../03-core-concepts/contracts.md).)

## Where every piece of state lives

| State | Home | Persisted | Notes |
|---|---|---|---|
| Session (phase, goal, agents, board, contracts, checkpoints, logs, versions) | Hub memory | `~/.duo/session.json` (write-through) | The single truth |
| User config (workspaces, runners, roles, preset, mode defaults) | — | `~/.duo/config.json` | Written by `duo init`, read by `start` |
| Hub liveness (PID, port) | — | `~/.duo/hub.pid` | For probe/reuse/cleanup |
| Session archives | — | `~/.duo/history/*.json` | On `duo stop` |
| Workspace artifacts (MCP configs, TASKS.md, contract mirrors) | — | agent workspaces | Exports for agents/git; never read back as truth |
| Agent conversation context | Agent process | vendor-side | Not our state; resume briefs reconstruct what matters ([agent-context-management.md](agent-context-management.md)) |
| CLI / dashboard | **nothing** | — | Pure clients; refresh-safe by construction |

## Concurrency notes

- Node's event loop serializes handlers; multi-step handlers complete synchronously (validate →
  mutate → persist) before yielding, so no interleaving corruption.
- Races that *reach* the hub concurrently (two `claim_task` for one item) resolve by arrival
  order; the loser gets a structured "already claimed" — pinned by fake-agent race tests
  ([testing-strategy.md](testing-strategy.md)).
- Idempotency for retry safety: re-register, re-claim by the same claimant, and re-post of a
  plan by its author are all no-op/replace — agents retrying after network blips can't corrupt
  state ([failure-recovery.md](failure-recovery.md)).

## v1 simplifications (explicit, revisitable)

- One session per machine ⇒ one session file, no session IDs in tool signatures (the hub stamps
  them internally for archives).
- Logs are capped in memory (ring buffer, configurable) — full history belongs in archives, not
  RAM.
- `history/` is never auto-pruned in v1.

# Strategy: Failure Recovery

> Every participant — agent, hub, connection, human — can die mid-session. The design goal:
> no failure loses committed coordination state, and every failure has a cheap, obvious resume
> path. Never a silent hang.

## Failure matrix

| Failure | Detection | Recovery |
|---|---|---|
| Agent process crashes | Adapter handle sees exit while items still claimed | Claims reopen; `duo resume <agent>` relaunches with resume brief |
| Agent hangs (no exit, no progress) | Human observes via `duo status` (no updates) | `duo resume <agent> --force` = stop + relaunch with brief |
| Hub crashes / machine reboots | CLI probe (`/health`) fails; PID stale | Hub restarts and restores state from `~/.duo/session.json`; agents' next tool call reconnects |
| MCP never attaches (cursor-agent quirk) | Registration deadline missed at launch | Loud failure + diagnosis; suggest `cursor-ide` fallback for that slot |
| Held call severed (network blip, client timeout) | Client-side error on the tool call | Kickoff instructs: retry the call; hub treats re-calls idempotently |
| Human walks away | Agents blocked at plan/checkpoint | By design: held calls time out and re-poll indefinitely at low cost; session waits |
| Editor closed (cursor-ide slot) | Same as agent crash | Re-paste flow: `duo resume` copies a resume kickoff to clipboard |

## The three mechanisms behind every row

### 1. Write-through persistence (hub state survives the hub)

Every mutation is persisted to `~/.duo/session.json` before the tool call returns
([state-management.md](state-management.md)). A restarted hub resumes exactly where it died —
board, contracts, checkpoints, phase. Agents don't even notice if the restart happens between
their calls: HTTP is connectionless between requests, and MCP session re-init is handled by the
SDK/client transparently.

### 2. Claims reopen (work is never stranded)

An agent that dies holding claims would otherwise block completion forever (the completion rule
refuses to finish with claimed items). So: adapter exit detection → hub releases that agent's
claims → `open` again, visible to the peer and the resumed agent. Partial work is safe because
it lives in the workspace (files, git) — reopening a claim never destroys anything; the resumed
agent picks up where the files say it stopped.

### 3. Resume briefs (context is reconstructable, cheaply)

The hub can always synthesize a condensed restart context — goal, remaining items, contracts in
force, peer completions, last feedback
([03-core-concepts/resume-system.md](../03-core-concepts/resume-system.md)). This is the
designed answer to the *only* legitimate second-session case
([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md)).

## Cursor MCP failures — the known-flaky path

`cursor-agent` print mode has community-reported MCP attachment issues. Defense in depth:

1. `duo doctor` checks attachment ahead of time (spawns a probe, expects `register_agent`).
2. Launch-time registration deadline → specific error, not a hang.
3. Adapter-level fallbacks: legacy SSE URL variant; polling kickoff instead of held calls.
4. Per-slot runner swap: `cursor-ide` (clipboard) works whenever a human can paste — the
   ultimate fallback for that slot without touching the rest of the session.

## Principles

- **Fail loud, fail specific.** Every timeout produces a message naming the component and the
  next command to run. Silent hangs are treated as bugs of the highest severity.
- **Idempotent re-calls.** `register_agent`, `claim_task` (by the same claimant), `post_plan`
  (re-post replaces own proposal) — agents retrying after blips must never corrupt state.
- **The filesystem is the recovery floor.** Workspace files, contract mirrors, TASKS.md, and the
  session JSON mean that even a total orchestration loss (delete `~/.duo/`) leaves the actual
  work and its interfaces intact and inspectable.
- **Recovery paths are tested** — fake-agent scenarios cover disconnects, hub kill/restart, and
  chaos calls ([testing-strategy.md](testing-strategy.md)); recovery code that isn't exercised
  is recovery code that doesn't work.

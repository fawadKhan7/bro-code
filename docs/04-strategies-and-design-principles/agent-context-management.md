# Strategy: Agent Context Management

> Deciding, deliberately, what lives in an agent's context window, what lives in the hub, and
> what is never repeated. The context window is the scarcest resource in the system.

## How context is created

An agent's context is assembled in layers, in this order:

1. **Kickoff prompt** (built once by the CLI's prompt builder):
   - Role brief (preset/custom — role, goal, focus-as-bias)
   - Workspace binding ("work only in …", peer identity)
   - Project map (regex scan of *its own* workspace only)
   - Protocol instructions (which tools, when, checkpoint rules, gap sweep)
2. **The agent's own exploration** — files it opens while planning/working (its choice, guided
   by the map and its claimed items).
3. **Tool results** — board deltas, contracts, checkpoint resolutions, resume briefs.

## What enters the prompt vs. what stays in the hub

| In the kickoff prompt | In the hub (fetched on demand) |
|---|---|
| Role, goal, workspace binding | Task board (live, changing) |
| Project map (static orientation) | Contracts (versioned facts) |
| Protocol rules (never change mid-session) | Checkpoint state, feedback |
| — | Logs, peer status, resume briefs |

The dividing rule: **the prompt carries only what is true for the whole session.** Anything that
changes (board, contracts, peer progress) would become stale in the prompt and re-sending it is
waste — so it lives in the hub and is fetched as deltas, exactly when needed.

## What should not be repeated

- **The peer's history.** An agent never reads its peer's conversation — only its artifacts
  (contracts, board completions with refs). Artifacts are hundreds of tokens; histories are
  hundreds of thousands.
- **Old contract/board versions.** `since_version` deltas make re-reads structurally
  unnecessary ([token-efficiency.md](token-efficiency.md)).
- **Code over MCP.** Refs (file paths) travel; the agent reads the file locally — always
  current, never duplicated in two contexts.
- **The other workspace's map.** Agent A gets A's map only. Cross-workspace knowledge arrives
  through contracts, which is the interface — literally.

## The session-spanning process

The plan → execute continuity rule
([02-architecture-upgrade/07-long-lived-sessions.md](../02-architecture-upgrade/07-long-lived-sessions.md))
is really a context-management rule: exploration context acquired during planning is *retained*
rather than *reconstructed*. Approval gates block inside tool calls precisely so the context
window survives them.

## Resume behavior after crashes

When a process genuinely dies, we accept a bounded context rebuild — the **resume brief**
([03-core-concepts/resume-system.md](../03-core-concepts/resume-system.md)):

```
resume kickoff = short protocol header
              + get_resume_brief result   (goal, its board items, contracts-in-force,
                                           peer completions, latest feedback — refs only)
```

Deliberately *not* included: the project map (the agent re-reads only files relevant to its
remaining items — usually a fraction of the original orientation), history, or peer details
beyond artifacts. A resume costs ~1k tokens of setup instead of a full cold start.

## Failure smells (what reviewers should reject)

- Any design that puts board/contract *content* into kickoff prompts.
- Any kickoff instruction that tells agents to poll.
- Any tool result that returns full lists where a delta parameter exists.
- Any flow where a healthy agent process exits and restarts between phases.

# Concept: MCP (Model Context Protocol)

## What it is

MCP is the open protocol that lets AI agents call tools exposed by external servers. In this
project it is the **coordination bus**: every agent↔hub interaction — getting the goal, posting
plans, claiming tasks, sharing contracts, pausing at checkpoints — is an MCP tool call.

## Why it exists (in this project)

You cannot push prompts *into* most AI agents mid-run, but every major agent can autonomously
call MCP tools. So coordination is **pull-based**: the hub holds state; agents fetch and post
via tools. This was generation 1's founding discovery and is precisely what makes the system
AI-agnostic — Claude Code, cursor-agent, and Cursor IDE all speak MCP, so all can be agents
without the hub knowing the difference.

## How it works

- **Transport:** streamable HTTP at `POST/GET /mcp` (current MCP standard), implemented with the
  official `@modelcontextprotocol/sdk`. Legacy SSE (`/sse` + `/message`) kept for older clients.
  Decision detail: [02-architecture-upgrade/03-mcp-transport-upgrade.md](../02-architecture-upgrade/03-mcp-transport-upgrade.md).
- **Configuration:** the CLI writes project-scoped config per workspace — `.mcp.json` (Claude
  Code) or `.cursor/mcp.json` (Cursor family) — pointing at the hub. No manual editing of global
  config files.

### The v1 tool catalog

| Tool | Phase | Purpose |
|---|---|---|
| `register_agent(agent_id, workspace_path)` | any | Announce presence; launch confirmation |
| `get_session_brief(agent_id)` | any | Goal, role, phase, peer info (kickoff backup) |
| `post_plan(agent_id, items[])` | planning | Propose board items |
| `await_plan_approval(agent_id)` | planning | Block until human approves (long-poll) |
| `get_plan_status(agent_id)` | planning | Polling fallback for the above |
| `get_board(since_version?)` | executing | Read board (delta-capable) |
| `claim_task(agent_id, task_id)` | executing | Take ownership (validated) |
| `complete_task(agent_id, task_id, refs?)` | executing | Mark done + leave file pointers |
| `post_contract(agent_id, content, title?, service?)` | executing | Share an interface (hashed, versioned, disk-mirrored) |
| `get_contracts(since_version?)` | executing | Read contracts (delta-capable) |
| `post_update(agent_id, message, refs?)` | any | Progress log (pushed live to humans) |
| `post_checkpoint(agent_id, summary, next_step)` | executing | Pause for human review |
| `get_checkpoint_status(agent_id)` | executing | `pending / approved / feedback` |
| `get_resume_brief(agent_id)` | any | Condensed context after crash/restart |
| `get_status()` | any | Session status snapshot |

Tools called out of phase return a cheap structured error (`{ phase, message }`) rather than
blocking — a confused agent can never hang the session.

## How it interacts with other components

- **Hub** implements the tools over its single state ([hub.md](hub.md)).
- **Agents** are MCP clients; their kickoff prompts teach them *when* to call *what*
  ([agent.md](agent.md)).
- **The REST/SSE surface is not MCP** — the CLI and dashboard are not agents and use plain HTTP.

## Example: one tool call round-trip

```
Agent B → tools/call claim_task { agent_id: "B", task_id: "t4" }
Hub     → validates: phase=executing ✓, t4 open ✓, t4.paths ⊂ workspace B ✓
        → t4.status = "claimed", t4.claimedBy = "B", boardVersion++
        → SSE event {type:"board", …} → CLI watch + dashboard update
        → tool result { ok: true, task: {…} }
```

# 🎼 Conductor

> Coordinate two Cursor background agents toward a shared goal — from a single terminal command.

## What it does

You give Conductor one goal. It frames that goal into two role-focused briefs (via a preset — no API keys), injects them into each Cursor project, and coordinates both agents through a shared MCP server. Agents pause at checkpoints for you to review and give feedback.

**Zero files added to your repos.** **Zero API keys.** Conductor never calls an external LLM — only Cursor’s own agents use models, on your existing plan.

---

## How it works

```
conductor start "Build a user auth system" 
        ↓
Frames goal per role preset → injects .cursor/rules into both project folders
        ↓
Both Cursor background agents start automatically
        ↓
Agents post structured updates to the MCP manager as they work
        ↓
After each major feature → both agents pause at a checkpoint
        ↓
conductor feedback "looks good, add refresh tokens"
        ↓
Agents resume with clean condensed context
```

---

## Setup

### 1. Install

```bash
npm install -g @conductor/cli
```

### 2. Add MCP server to Cursor

In your Cursor settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "conductor": {
      "command": "node",
      "args": ["/path/to/conductor/mcp-server/dist/index.js"]
    }
  }
}
```

---

## Usage

```bash
# One-time: register both project folders + default role preset
conductor init

# Start a session (uses preset from init, or pass --preset)
conductor start "Build a task management app with auth" --preset frontend-backend

# Or write each brief yourself — no splitting logic needed
conductor start --agent-a "Implement REST auth API" --agent-b "Login UI + token storage"

# Monitor progress
conductor status

# Review checkpoint and give feedback
conductor feedback "auth looks good, now add the dashboard"
# or just continue
conductor feedback

# Stop and clean up
conductor stop
```

---

## Agent role presets (no LLM — static templates)

`conductor init` saves a default preset. On `conductor start`, the CLI injects the **same shared goal** into both workspaces, plus a fixed role block per agent (focus areas, boundaries, what to post via MCP). No API keys, no paid splitter.

| Preset | Agent A | Agent B |
|---|---|---|
| `frontend-backend` | Frontend | Backend |
| `builder-reviewer` | Builder | Reviewer |
| `architect-implementer` | Architect | Implementer |
| `feature-tests` | Feature Builder | Test Writer |
| `service-ab` | Service A | Service B |
| `custom` | You define in `conductor init` or `--agent-a` / `--agent-b` |

Example injected focus (preset `frontend-backend`, goal *"Build auth"*):

- **Agent A:** UI, client flows, forms, token storage in the browser; depend on B’s API contract via `get_contract`.
- **Agent B:** Routes, JWT/session, DB models; publish endpoints early with `post_update` + `refs`.

For uneven goals, skip presets and pass explicit `--agent-a` / `--agent-b` strings.

---

## Token efficiency

- Agents only receive **structured deltas** — not raw output from each other
- `get_contract` accepts a `sinceVersion` parameter — agents never re-read old updates
- At each checkpoint resume, `get_resume_brief` provides a **clean condensed context** replacing bloated history
- **Goal framing** uses preset templates only — zero LLM, zero API keys
- **Codebase scan** uses AST/regex only — zero LLM
- **MCP manager** uses zero LLM calls — pure logic

---

## MCP Tools available to agents

| Tool | When to use |
|---|---|
| `get_contract` | Before starting any new task |
| `post_update` | After producing something the other agent depends on |
| `post_checkpoint` | After completing a major feature |
| `get_resume_brief` | After checkpoint resume to get clean context |
| `get_status` | To check if peer finished something you depend on |

---

## Project structure

```
conductor/
  shared/          # Shared TypeScript types
  mcp-server/      # MCP manager server
  cli/             # conductor CLI
```

---

## License

MIT


Mid-project: Codebase Scan on conductor start
When you run conductor start, before injecting .cursor/rules, the CLI scans each folder and builds a lightweight project snapshot — not the code, just the map:
src/
  auth/
    auth.service.ts      ← exports: AuthService, generateToken
    auth.controller.ts   ← routes: POST /auth/login, POST /auth/register
  users/
    user.model.ts        ← exports: User, UserSchema
This snapshot gets injected into each agent's .cursor/rules as a "Project Map" section. Agent immediately knows what exists, where it is, what it exports — without reading every file.
For greenfield projects — scan returns empty, nothing injected. Same code path, zero special casing.

File References in MCP Messages
When an agent calls post_update, it can include a refs array:
json{
  "from": "agent-a",
  "type": "endpoint",
  "summary": "JWT auth implemented, login + register ready",
  "diff": {
    "added": ["POST /auth/login", "POST /auth/register"]
  },
  "refs": [
    "src/auth/auth.service.ts",
    "src/auth/auth.controller.ts"
  ]
}
The other agent's get_contract response includes those paths. Agent navigates there itself. No code travels over MCP — just pointers.

Updated post_update tool schema
tsrefs: z.array(z.string()).optional()
  .describe("File paths the other agent should look at. Relative to project root.")
And get_contract response becomes:
[v3] agent-a → JWT auth implemented, login + register ready
     refs: src/auth/auth.service.ts, src/auth/auth.controller.ts
One line. Agent knows exactly where to look.

The scan itself — what it does
conductor start (mid-project)
        ↓
CLI scans each folder:
  - Reads directory tree (ignores node_modules, .git, dist)
  - For .ts/.js files: extracts exports + function signatures (1 line each)
  - For config files: notes their existence
  - Max depth: 4 levels
  - Output: plain text map, ~100-300 lines depending on project size
        ↓
Injected into .cursor/rules as "Existing Codebase" section
        ↓
Agent starts with full spatial awareness of the project
The scan uses no LLM — pure AST/regex extraction. Zero tokens, zero cost.
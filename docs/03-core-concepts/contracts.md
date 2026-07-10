# Concept: Contracts

## What it is

A contract is a versioned, content-hashed message one agent posts so others can integrate
against it: API endpoint shapes, file formats, DB schemas, TypeScript interfaces, shared
constants. It is the project's oldest proven primitive, carried forward from generation 1
nearly unchanged.

## Why it exists

Parallel agents have dependencies: the frontend needs the API shape the backend is building.
Without contracts, the dependent agent either polls ("is the API ready yet?" — token waste) or
guesses (integration rework). Contracts invert it: the producing agent posts the shape **as soon
as it's decided — before it's implemented**; the consuming agent reads it once, exactly when it
needs to integrate.

## How it works

```
Agent B: post_contract(agent_id: "B", service: "auth-api",
                       content: "POST /auth/google/callback → { token, user }…")
  hub → contentHash = SHA-256(content)
      → revision  = next revision for slug "auth-api"
      → disk mirror: prepend revision block to contracts/auth-api.md in B's workspace
      → contractVersion++ (global, for deltas)

Agent A (later): get_contracts(since_version: 2)
  → only contracts newer than version 2 — never re-reads old ones
```

Key properties (implementation exists in [`src/contractDisk.ts`](../../src/contractDisk.ts) and
`src/mcpServer.ts`, ported in phase 1):

- **`contentHash`** — SHA-256; detects drift across sessions.
- **`revision`** — monotonic per `service` slug; one slug = one topic = one file.
- **Disk mirror** — `contracts/<service>.md` in the poster's workspace, newest revision block
  first. Git-auditable; CI-checkable (`scripts/check-contracts.mjs`); survives everything.
- **`refs`** — file paths, not code. Consumers navigate to the source themselves; no code
  travels over MCP (from Conductor).
- **Delta reads** — `since_version` parameter (from Conductor), new in the merged system for
  contracts specifically (generation 1 returned everything).

## How it interacts with other components

- **Task board** ([task-board.md](task-board.md)): the board tracks *work*; contracts record the
  *interfaces* that work produces. Completing "implement auth API" typically means one
  `complete_task` (with refs) and one `post_contract` (with shapes).
- **Resume system** ([resume-system.md](resume-system.md)): resume briefs embed current contract
  state so a restarted agent knows every agreed interface without replaying history.
- **Token efficiency** ([token-efficiency.md](../04-strategies-and-design-principles/token-efficiency.md)):
  contracts are the structured alternative to agents "conversing".

## Example contract on disk

```markdown
<!-- contracts/auth-api.md (agent B's workspace) -->
## rev 2 — 2026-07-10T14:12:03Z — agent B — sha256:9f2c…
POST /auth/google           → 302 redirect to Google consent
GET  /auth/google/callback  → { token: string (JWT, 24h), user: { id, email, name } }
Errors: 401 { error: "oauth_denied" } | 409 { error: "email_exists" }

## rev 1 — 2026-07-10T13:40:11Z — agent B — sha256:1b7a…
(draft: callback returned only { token })
```

# Concept: Project Scanner

## What it is

A zero-LLM, regex-based scanner that turns a workspace into a compact plain-text **project map**
— what files exist, what they export, what routes they define — injected into each agent's
kickoff prompt. Implementation exists at
[`conductor/shared/src/scan.ts`](../../conductor/shared/src/scan.ts) (ported in phase 1).

## Why it exists

An agent dropped into an unfamiliar repo spends its first minutes (and thousands of tokens)
running `ls`/`grep`/file-reads just to orient. The scanner pre-pays that cost with milliseconds
of filesystem reads: the agent starts already knowing the terrain and opens only the files its
actual tasks touch. It also makes **planning** cheap — proposals can be drafted largely off the
map ([planning-phase.md](planning-phase.md)).

## How it works

1. **Walk** the directory tree, max 4 levels deep; skip `node_modules`, `.git`, `dist`, `build`,
   `.next`, `__pycache__`, `.venv`, dotdirs, etc.
2. **Per file**, produce one line of hints:
   - Known config files (`package.json`, `Dockerfile`, `docker-compose.yml`, …) → `← config`
   - JS/TS files → regex extraction:
     - exports: `export function|class|const|type|interface|enum X`, `export { a, b }` (≤12/file)
     - Express-style routes: `app.get('/path')`, `router.post('/path')` (≤8/file)
3. **Assemble**, capped at 400 lines:

```
# Existing Codebase
Root: /Users/x/proj/api

src/auth/auth.service.ts     ← exports: AuthService, generateToken, verifyToken
src/auth/auth.controller.ts  ← routes: POST /auth/login, POST /auth/register
src/users/user.model.ts      ← exports: User, UserSchema
package.json                 ← config
```

Greenfield folder → empty map → nothing injected. Same code path, no special casing.

**Honest naming note:** earlier docs called this an "AST scan" — it is regex over file text, not
a syntax tree. That's the right trade-off (fast, zero deps, tolerant of broken code), and the
output format wouldn't change if a real parser (tree-sitter) replaced the internals later.

## Known limits (v1 backlog)

- **JS/TS only** — Python/Go/Java exports are invisible. Fix: add per-language patterns.
- **Express routes only** — Next.js file-routes, FastAPI decorators, etc. not detected.
- Cap-based truncation on very large repos (400 lines) — deepest paths lose detail first.

## How it interacts with other components

- **CLI** runs it per workspace during `duo start`; output goes into the kickoff prompt via the
  prompt builder.
- **Token efficiency**: it is the "scans instead of AI exploration" pillar
  ([token-efficiency.md](../04-strategies-and-design-principles/token-efficiency.md)).
- **Not used mid-session** — after kickoff, agents explore normally; the map is orientation,
  not a live index.

# Strategy: Testing

> The protocol is tested with fake agents (fast, free, deterministic); real AIs are used only
> to validate prompts and adapters (slow, paid, rare). Never invert this.

## The layered pyramid

```
        ┌──────────────────────────────┐
        │  Manual real-AI smoke runs   │  rare: before releases, per adapter
        ├──────────────────────────────┤
        │  Adapter integration tests   │  mocked process spawning; a few real
        │                              │  `claude -p` / `cursor-agent` probes
        ├──────────────────────────────┤
        │  FAKE-AGENT PROTOCOL SUITE   │  every commit — the heart of CI
        ├──────────────────────────────┤
        │  Unit tests                  │  scanner, presets, prompt builder,
        │                              │  merge logic, state persistence
        └──────────────────────────────┘
```

## Why fake agents are important

A fake agent ([03-core-concepts/fake-agents.md](../03-core-concepts/fake-agents.md)) is a
scripted MCP client that plays an agent deterministically. They matter because the alternative
is testing the hub through real LLMs, which fails on every axis:

| | Real agents | Fake agents |
|---|---|---|
| Speed | minutes per scenario | milliseconds |
| Cost | real tokens, every run | zero |
| Determinism | LLM may improvise → flaky CI | exact |
| Failure injection | nearly impossible ("please crash mid-claim") | trivial |
| CI viability | no | yes, every commit |

They're built in **phase 1, before any real adapter** — so by the time a real AI first connects,
every tool, phase gate, race, and recovery path already has pinned, passing tests. From then on
they're the permanent regression net: hub refactors, SDK upgrades, and transport changes must
pass the same suite.

## Hub testing without AI tokens

The harness: spawn a real hub on a random port → connect 2 (or N) fake agents → play the human
via the REST API → assert on tool results, hub state, persisted session file, and SSE events.

Core scenario groups:

1. **Happy path** — full plan → approve → execute → done; `--no-plan` variant; trivial-plan
   auto-approve.
2. **Races** — simultaneous plan posts; both agents claiming one item; concurrent completes.
3. **Rule enforcement** — out-of-phase calls answered cheaply; cross-workspace claims rejected;
   completion refused with open items; unassigned items blocking approval.
4. **Recovery** — agent disconnect (claims reopen), hub kill -9 + restart (state restored from
   `~/.duo/session.json`), held-call timeout/retry semantics.
5. **Chaos agent** — deliberately wrong tool usage; assert the hub never hangs and always
   returns structured errors.
6. **Transport parity** — the same scenario over streamable HTTP and legacy SSE must produce
   identical results.

## Adapter testing

Adapters are thin, so their tests are thin:

- **Unit (mocked spawn):** correct binary, args, cwd, env; config files written correctly and
  idempotently; stream-json parsed into hub log events; premature-exit detection.
- **Real probes (opt-in, `DUO_REAL_AGENTS=1`):** `detect()` against the installed binary; one
  minimal end-to-end run per adapter with a one-line task ("create hello.txt") — validates MCP
  attachment, registration, and the held-call behavior on the real client. Run before releases,
  not in CI.

## Prompt/kickoff testing

Prompts can't be unit-tested; they're validated by the real smoke runs plus **golden-file tests
on the prompt builder** (given config X, the kickoff text is exactly Y) so prompt changes are
always visible in diffs, reviewed like code.

## Regression testing approach

- The fake-agent suite is a **merge gate** from phase 1 onward.
- Every bug found with a real agent gets reproduced as a fake-agent scenario first (if it's a
  protocol bug) or a golden-prompt change (if it's a prompt bug) — then fixed.
- `duo doctor` doubles as the user-facing end of testing: it runs the same detection and health
  probes the test suite uses.

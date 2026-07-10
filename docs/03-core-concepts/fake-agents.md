# Concept: Fake Agents

## What it is

A fake agent is a **scripted MCP client** — a small Node program that connects to the hub and
plays an agent's role deterministically: registers, posts a plan, waits for approval, claims
items, posts contracts, completes work. No LLM anywhere.

## Why it exists

The hub is the system's correctness core, and testing it with real agents would be slow
(minutes per run), expensive (real tokens), and flaky (nondeterministic LLM behavior). Fake
agents make the full protocol testable in **milliseconds, for free, deterministically** — which
is why they're built in phase 1, *before* any real adapter exists. They are the project's
permanent regression net: every future change to hub, tools, or transport runs against them in
CI. Full strategy: [testing-strategy.md](../04-strategies-and-design-principles/testing-strategy.md).

## How it works

A fake agent is a scenario script over a tiny MCP client library:

```ts
const a = await FakeAgent.connect(hubUrl, { id: "A", workspace: tmpA });
await a.register();
await a.postPlan([
  { title: "Login UI", ownerHint: "A", paths: ["src/login/"] },
  { title: "Deploy config", ownerHint: null, paths: ["infra/"] },
]);
const approval = a.awaitPlanApproval();          // held call
await harness.rest.approvePlan({ assign: { t3: "B" } });   // simulate the human
expect((await approval).approved).toBe(true);
await a.claim("t1");
await a.postContract({ service: "login-ui", content: "…" });
await a.complete("t1", { refs: ["src/login/LoginPage.tsx"] });
```

The test harness spawns a real hub on a random port, runs two fake agents concurrently, plays
the human via the REST API, and asserts on hub state and SSE events.

### What fake agents deliberately test

- **Happy path**: full plan → approve → execute → done session.
- **Races**: both agents claiming the same item; simultaneous plan posts.
- **Rule enforcement**: out-of-phase tool calls, claims across workspace boundaries, completion
  refused while items remain open.
- **Failure modes**: agent disconnects mid-claim (items reopen), hub restart mid-session
  (state restored from disk), held-call timeout/retry.
- **Misbehavior**: a "chaos" fake agent that calls tools wrongly on purpose — asserting the hub
  answers cheaply and never hangs.

### What they cannot test

Whether *real* LLMs follow the kickoff prompts (prompt quality), and adapter/launch mechanics.
Those get a thin layer of real smoke tests in phases 2–3 — expensive, run rarely, kept minimal
because everything below the prompt layer is already pinned by fake agents.

## How it interacts with other components

- **Hub** — the system under test; fake agents exercise every tool and phase gate.
- **Adapters** — bypassed entirely (that's the point).
- **CI** — fake-agent suites are the acceptance criteria of phase 1 and a merge gate thereafter
  ([05-implementation-plan/phase-01-hub-extraction.md](../05-implementation-plan/phase-01-hub-extraction.md)).

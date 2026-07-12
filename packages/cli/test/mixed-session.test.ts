/** Mixed-session orchestration (tokenless), now hub-owned: the runner label must not change
 *  orchestration — cursor-cli↔claude-code drives identically. Manual-slot (cursor-ide) launch
 *  is simulated to confirm the supervisor's extended registration window.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ScriptedAdapter, type AgentScript, type ScriptClient } from "./scriptedAgent.js";
import { bootHub, teardown, waitForPhase, waitForAllRegistered, waitForProposal, finishOwned, type BootedHub } from "./hubHarness.js";
import type { Runner } from "@duo/shared";

let booted: BootedHub | undefined;
afterEach(async () => {
  await teardown(booted);
  booted = undefined;
});

const noPlan: AgentScript = async (c: ScriptClient) => {
  await c.register();
  await finishOwned(c);
};

describe("mixed sessions (runner-agnostic, hub-owned)", () => {
  it("cursor-cli (A) ↔ claude-code (B) completes over REST", async () => {
    const adapter = new ScriptedAdapter({ scripts: { A: noPlan, B: noPlan } });
    booted = await bootHub(adapter, { runnerA: "cursor-cli" as Runner, runnerB: "claude-code" as Runner });
    await booted.client.post("/api/session/start", { goal: "Add auth", plan: false, registrationTimeoutMs: 5000 });
    await waitForPhase(booted.client, "done");
  });

  it("claude-code (A) ↔ cursor-cli (B) with a full plan→approve cycle", async () => {
    const scriptA: AgentScript = async (c) => {
      await c.register();
      await c.postPlan([{ title: "UI", ownerHint: "A" }]);
      await c.awaitApproval();
      await finishOwned(c);
    };
    const scriptB: AgentScript = async (c) => {
      await c.register();
      await c.postPlan([{ title: "API", ownerHint: "B" }]);
      await c.awaitApproval();
      await finishOwned(c);
    };
    const adapter = new ScriptedAdapter({ scripts: { A: scriptA, B: scriptB } });
    booted = await bootHub(adapter, { runnerA: "claude-code" as Runner, runnerB: "cursor-cli" as Runner });
    await booted.client.post("/api/session/start", {
      goal: "Add auth",
      plan: true,
      autoApproveTrivial: false,
      registrationTimeoutMs: 5000,
    });
    await waitForProposal(booted.client, 2);
    await booted.client.approvePlan({});
    await waitForPhase(booted.client, "done");
  });

  it("manual slot (cursor-ide) with slow paste still passes the registration gate", async () => {
    const slowManual: AgentScript = async (c) => {
      await new Promise((r) => setTimeout(r, 500)); // human "pastes" after 500ms
      await c.register();
      await finishOwned(c);
    };
    // registrationTimeoutMs 200 would fail a process slot; a manual handle extends the window.
    const adapter = new ScriptedAdapter({ scripts: { A: slowManual, B: noPlan }, manualAgents: ["A"] });
    booted = await bootHub(adapter, { runnerA: "cursor-ide" as Runner, runnerB: "claude-code" as Runner });
    await booted.client.post("/api/session/start", { goal: "Add auth", plan: false, registrationTimeoutMs: 200 });
    await waitForAllRegistered(booted.client, 8000);
    await waitForPhase(booted.client, "done");
  });
});

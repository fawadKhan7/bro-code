/** Phase 6: session lifecycle driven over REST against a HUB that owns the agents.
 *  The hub's SessionSupervisor launches scripted agents (fake adapter injected at Hub construction),
 *  so the whole orchestration path is exercised with zero AI tokens — now including the REST
 *  session-start endpoint that a GUI will use.
 */
import * as fs from "fs";
import { afterEach, describe, expect, it } from "vitest";
import { HubClient } from "../src/hubClient.js";
import { ScriptedAdapter, type AgentScript, type ScriptClient } from "./scriptedAgent.js";
import { bootHub, teardown, waitForPhase, waitForAllRegistered, waitForProposal, finishOwned, type BootedHub } from "./hubHarness.js";

let booted: BootedHub | undefined;

afterEach(async () => {
  await teardown(booted);
  booted = undefined;
});

async function boot(adapter: ScriptedAdapter, opts?: { mode?: "auto-run" | "checkpoint" }): Promise<HubClient> {
  booted = await bootHub(adapter, opts);
  return booted.client;
}

describe("hub-owned session lifecycle over REST", () => {
  it("start → plan → approve → execute → done, agents owned by the hub", async () => {
    const scriptA: AgentScript = async (c) => {
      await c.register();
      await c.postPlan([{ title: "Login UI", ownerHint: "A", paths: ["web/"] }]);
      await c.awaitApproval();
      await finishOwned(c);
    };
    const scriptB: AgentScript = async (c) => {
      await c.register();
      await c.postPlan([
        { title: "Auth API", ownerHint: "B", paths: ["api/"] },
        { title: "Deploy secrets", ownerHint: null, paths: ["infra/"] },
      ]);
      await c.awaitApproval();
      await c.postContract("service: auth-api\nPOST /auth/login → { token }", "api");
      await finishOwned(c);
    };
    const adapter = new ScriptedAdapter({ scripts: { A: scriptA, B: scriptB } });
    const client = await boot(adapter);

    const started = (await client.post("/api/session/start", {
      goal: "Add auth",
      plan: true,
      autoApproveTrivial: false,
      registrationTimeoutMs: 5000,
    })) as { ok?: boolean };
    expect(started.ok).toBe(true);

    await waitForAllRegistered(client);
    await waitForProposal(client, 3);
    expect(adapter.configureCalls.length).toBe(2); // hub configured both agents

    const board = (await client.board()) as { plan: { unassigned: string[] } };
    expect(board.plan.unassigned).toHaveLength(1);
    const approve = await client.approvePlan({ assign: { [board.plan.unassigned[0]]: "B" } });
    expect(approve.ok).toBe(true);

    await waitForPhase(client, "done");
  });

  it("--no-plan executes the preset board (no planning phase)", async () => {
    const script: AgentScript = async (c) => {
      await c.register();
      await finishOwned(c);
    };
    const client = await boot(new ScriptedAdapter({ scripts: { A: script, B: script } }));
    const started = (await client.post("/api/session/start", { goal: "Fix typo", plan: false, registrationTimeoutMs: 5000 })) as { ok?: boolean };
    expect(started.ok).toBe(true);
    await waitForPhase(client, "done");
    const s = (await client.status()) as { proposedItems: number };
    expect(s.proposedItems).toBe(0);
  });

  it("surfaces a launch failure via status.launchError (loud, no hang)", async () => {
    const good: AgentScript = async (c) => {
      await c.register();
      await finishOwned(c);
    };
    const silent: AgentScript = async () => {
      await new Promise((r) => setTimeout(r, 10_000)); // never registers
    };
    const client = await boot(new ScriptedAdapter({ scripts: { A: good, B: silent } }));
    await client.post("/api/session/start", { goal: "goal", plan: false, registrationTimeoutMs: 600 });

    const start = Date.now();
    let err: string | null = null;
    while (Date.now() - start < 4000) {
      const s = (await client.status()) as { launchError?: string | null };
      if (s.launchError) { err = s.launchError; break; }
      await new Promise((r) => setTimeout(r, 60));
    }
    expect(err).toContain("did not register");
    expect(err).toContain("B");
  });

  it("auto-resumes a crashed agent from its resume brief", async () => {
    const crashOnce: AgentScript = async (c) => {
      await c.register();
      const board = (await c.getBoard()) as { items: Array<{ id: string; owner: string }> };
      await c.claim(board.items.find((i) => i.owner === "A")!.id);
      return; // crash: item left claimed
    };
    const resumeA: AgentScript = async (c) => {
      await c.register();
      const brief = (await c.resumeBrief()) as { brief: string };
      if (!brief.brief.includes("Add auth")) throw new Error("resume brief missing goal");
      await finishOwned(c);
    };
    const scriptB: AgentScript = async (c) => {
      await c.register();
      await finishOwned(c);
    };
    const adapter = new ScriptedAdapter({ scripts: { A: crashOnce, B: scriptB }, resumeScripts: { A: resumeA } });
    const client = await boot(adapter);
    await client.post("/api/session/start", { goal: "Add auth", plan: false, registrationTimeoutMs: 5000 });
    await waitForPhase(client, "done", 8000);
  });

  it("stop over REST terminates agents and archives", async () => {
    const script: AgentScript = async (c) => {
      await c.register();
      // linger so the session is still active when we stop it
      await new Promise((r) => setTimeout(r, 5000));
    };
    const client = await boot(new ScriptedAdapter({ scripts: { A: script, B: script } }));
    await client.post("/api/session/start", { goal: "goal", plan: false, registrationTimeoutMs: 5000 });
    await waitForAllRegistered(client);
    const res = (await client.stopSession()) as { ok?: boolean; archive?: string | null };
    expect(res.ok).toBe(true);
    expect(res.archive && fs.existsSync(res.archive)).toBe(true);
    expect(((await client.status()) as { active: boolean }).active).toBe(false);
  });
});

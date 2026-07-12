/** Phase 5: human-facing fields (contract summary, checkpoint why/impact, plan_summary) and the
 *  ask-a-question loop. New fields are additive — old-style calls without them still work.
 */
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

describe("contract summary", () => {
  it("carries a plain-language summary and surfaces it in the log + REST", async () => {
    h = await startHarness();
    await h.createSession("goal", { plan: false, presetBoard: [{ title: "A", ownerHint: "A" }, { title: "B", ownerHint: "B" }] });
    const a = await h.connectAgent("A");
    await a.register();
    const res = await a.call("post_contract", {
      agent_id: "A",
      summary: "Login returns a JWT token plus the user's id and email.",
      content: "service: auth\nPOST /login → { token, user: { id, email } }",
    });
    expect(res.ok).toBe(true);

    const contracts = (await fetch(`${h.url}/api/contracts`).then((r) => r.json())) as {
      contracts: Array<{ summary?: string }>;
    };
    expect(contracts.contracts[0].summary).toContain("JWT token");
  });

  it("still accepts a contract with no summary (backwards compatible)", async () => {
    h = await startHarness();
    await h.createSession("goal", { plan: false, presetBoard: [{ title: "A", ownerHint: "A" }, { title: "B", ownerHint: "B" }] });
    const a = await h.connectAgent("A");
    await a.register();
    const res = await a.call("post_contract", { agent_id: "A", content: "service: x\nPOST /x" });
    expect(res.ok).toBe(true);
  });
});

describe("plan summary", () => {
  it("stores plan_summary per agent and returns it in plan status", async () => {
    h = await startHarness();
    await h.createSession("goal");
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await b.register();
    await a.call("post_plan", {
      agent_id: "A",
      items: [{ title: "Login UI", ownerHint: "A" }],
      plan_summary: "I'll build the login screen and wire it to B's auth API.",
    });
    await b.call("post_plan", { agent_id: "B", items: [{ title: "Auth API", ownerHint: "B" }, { title: "extra", ownerHint: "B" }] });

    const plan = (await a.call("get_plan_status", { agent_id: "A" })) as {
      posted: Array<{ agentId: string; summary: string | null }>;
    };
    const aRow = plan.posted.find((p) => p.agentId === "A")!;
    expect(aRow.summary).toContain("login screen");
    const bRow = plan.posted.find((p) => p.agentId === "B")!;
    expect(bRow.summary).toBeNull();
  });
});

describe("checkpoint why/impact + question loop", () => {
  it("checkpoint carries why and impact through to status", async () => {
    h = await startHarness();
    await h.createSession("goal", { mode: "checkpoint", plan: false, presetBoard: [{ title: "A", ownerHint: "A" }, { title: "B", ownerHint: "B" }] });
    const a = await h.connectAgent("A");
    await a.register();
    await a.call("post_checkpoint", {
      agent_id: "A",
      summary: "Auth built",
      next_step: "Run the DB migration",
      why: "The migration drops and recreates the users table.",
      impact: "Existing dev data will be wiped.",
    });
    const status = (await h.human.status()) as {
      agents: Array<{ id: string; checkpoint: { why?: string; impact?: string; kind?: string } | null }>;
    };
    const cp = status.agents.find((x) => x.id === "A")!.checkpoint!;
    expect(cp.why).toContain("drops and recreates");
    expect(cp.impact).toContain("wiped");
    expect(cp.kind).toBe("checkpoint");
  });

  it("ask-a-question: agent asks, user answers via feedback, agent proceeds", async () => {
    h = await startHarness();
    await h.createSession("goal", { mode: "checkpoint", plan: false, presetBoard: [{ title: "A", ownerHint: "A" }, { title: "B", ownerHint: "B" }] });
    const a = await h.connectAgent("A");
    await a.register();

    const posted = await a.call("post_checkpoint", {
      agent_id: "A",
      summary: "Should the login use email or username?",
      next_step: "Build the login form once you tell me",
      kind: "question",
    });
    expect(String(posted.message)).toContain("answer");

    // Agent waits for the answer; user replies via the feedback channel.
    const waiting = a.call("get_checkpoint_status", { agent_id: "A", wait: true });
    await new Promise((r) => setTimeout(r, 100));
    await h.human.resolveCheckpoint("A", false, "Use email.");
    const answered = (await waiting) as { status: string; feedback: string; kind: string };
    expect(answered.status).toBe("feedback");
    expect(answered.feedback).toBe("Use email.");
    expect(answered.kind).toBe("question");
  });
});

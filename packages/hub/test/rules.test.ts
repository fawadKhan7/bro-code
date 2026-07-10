/** Rule enforcement: phase gates, ownership claims, completion rule,
 *  plan item caps, out-of-scope is human-only, plan feedback round.
 */
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, OAUTH_PLAN, type Harness } from "./harness.js";

let h: Harness;

afterEach(async () => {
  await h.cleanup();
});

async function setupExecuting() {
  h = await startHarness();
  await h.createSession("Add Google OAuth login");
  const a = await h.connectAgent("A");
  const b = await h.connectAgent("B");
  await a.register();
  await b.register();
  await a.postPlan(OAUTH_PLAN.fromA);
  await b.postPlan(OAUTH_PLAN.fromB);
  const plan = (await a.planStatus()) as { unassigned: string[] };
  await h.human.approvePlan({ assign: { [plan.unassigned[0]]: "B" } });
  return { a, b };
}

describe("phase gates", () => {
  it("claim/complete are rejected during planning with a redirect message", async () => {
    h = await startHarness();
    await h.createSession("goal");
    const a = await h.connectAgent("A");
    await a.register();

    const claim = await a.claim("t1");
    expect(claim.ok).toBe(false);
    expect(String(claim.error)).toContain("planning");

    const complete = await a.complete("t1");
    expect(complete.ok).toBe(false);
  });

  it("post_plan is rejected after approval", async () => {
    const { a } = await setupExecuting();
    const res = await a.postPlan([{ title: "late idea", ownerHint: "A" }]);
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("get_board");
  });
});

describe("plan rules", () => {
  it("caps plan size at 15 items", async () => {
    h = await startHarness();
    await h.createSession("goal");
    const a = await h.connectAgent("A");
    await a.register();
    const items = Array.from({ length: 16 }, (_, i) => ({ title: `item ${i}`, ownerHint: "A" }));
    const res = await a.postPlan(items);
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("15");
  });

  it("re-posting replaces the agent's own proposal (idempotent revision)", async () => {
    h = await startHarness();
    await h.createSession("goal");
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await b.register();

    await a.postPlan([{ title: "v1 idea", ownerHint: "A" }]);
    await a.postPlan([{ title: "v2 idea", ownerHint: "A" }, { title: "v2 second", ownerHint: "A" }]);
    await b.postPlan([{ title: "backend", ownerHint: "B" }]);

    const plan = (await a.planStatus()) as { proposedBoard: Array<{ title: string }> };
    const titles = plan.proposedBoard.map((i) => i.title);
    expect(titles).toContain("v2 idea");
    expect(titles).not.toContain("v1 idea");
  });

  it("merge de-duplicates items with the same normalized title", async () => {
    h = await startHarness();
    await h.createSession("goal");
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await b.register();

    await a.postPlan([{ title: "Users google_id migration!", ownerHint: null }, { title: "Login UI", ownerHint: "A" }]);
    await b.postPlan([{ title: "users google-id migration", ownerHint: "B" }]);

    const plan = (await a.planStatus()) as { proposedBoard: Array<{ title: string; owner: string | null }> };
    expect(plan.proposedBoard).toHaveLength(2);
    // The duplicate's ownerHint fills the first item's missing owner.
    const migration = plan.proposedBoard.find((i) => i.title.toLowerCase().includes("migration"))!;
    expect(migration.owner).toBe("B");
  });

  it("plan feedback clears proposals for a revision round and unblocks waiters", async () => {
    h = await startHarness();
    await h.createSession("goal");
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await b.register();
    await a.postPlan(OAUTH_PLAN.fromA);
    await b.postPlan(OAUTH_PLAN.fromB);

    const waiting = a.awaitPlanApprovalUntilDecided();
    await new Promise((r) => setTimeout(r, 100));
    await h.human.planFeedback("split the token work into its own item");
    const decision = await waiting;
    expect(decision.approved).toBe(false);
    expect(String(decision.feedback)).toContain("token");

    const plan = (await a.planStatus()) as { posted: Array<{ posted: boolean }> };
    expect(plan.posted.every((p) => !p.posted)).toBe(true); // agents must re-post
    expect(((await a.status()) as { phase: string }).phase).toBe("planning");
  });
});

describe("ownership and completion", () => {
  it("rejects claiming another agent's item", async () => {
    const { a } = await setupExecuting();
    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }> };
    const theirs = board.items.find((i) => i.owner === "B")!;
    const res = await a.claim(theirs.id);
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("owned by Agent B");
  });

  it("rejects completing an unclaimed item", async () => {
    const { a } = await setupExecuting();
    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }> };
    const mine = board.items.find((i) => i.owner === "A")!;
    const res = await a.complete(mine.id);
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("not claimed");
  });

  it("session cannot end while items remain; human out-of-scope closes the gap", async () => {
    const { a, b } = await setupExecuting();
    const board = (await a.getBoard()) as {
      items: Array<{ id: string; owner: string }>;
    };

    // Complete everything except one of B's items.
    const leftover = board.items.filter((i) => i.owner === "B").at(-1)!;
    for (const item of board.items) {
      if (item.id === leftover.id) continue;
      const agent = item.owner === "A" ? a : b;
      await agent.claim(item.id);
      await agent.complete(item.id);
    }

    expect(((await a.status()) as { phase: string }).phase).toBe("executing");

    // Agents cannot mark out-of-scope (no such tool) — only the human can.
    const res = await h.human.markOutOfScope([leftover.id]);
    expect(res.ok).toBe(true);
    expect(((await a.status()) as { phase: string }).phase).toBe("done");
  });
});

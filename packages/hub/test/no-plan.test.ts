/** --no-plan mode: session starts in `executing` with a preset-derived board;
 *  planning tools answer cheaply instead of blocking. Plus the trivial-plan fast path.
 */
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;

afterEach(async () => {
  await h.cleanup();
});

describe("--no-plan mode", () => {
  it("starts executing with the pre-filled board and rejects planning tools cheaply", async () => {
    h = await startHarness();
    await h.createSession("Fix the login typo", {
      plan: false,
      presetBoard: [
        { title: "Frontend: fix the login typo", ownerHint: "A", paths: ["src/"] },
        { title: "Backend: fix the login typo", ownerHint: "B", paths: ["src/"] },
      ],
    });
    const a = await h.connectAgent("A");
    await a.register();

    expect(((await a.status()) as { phase: string }).phase).toBe("executing");

    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }> };
    expect(board.items).toHaveLength(2);
    expect(board.items.map((i) => i.owner).sort()).toEqual(["A", "B"]);

    // A confused agent posting a plan anyway gets a cheap redirect, not a hang.
    const rejected = await a.postPlan([{ title: "extra", ownerHint: "A" }]);
    expect(rejected.ok).toBe(false);
    expect(String(rejected.error)).toContain("skipped");

    // await_plan_approval returns immediately as approved (phase already executing).
    const approval = await a.awaitPlanApproval();
    expect(approval.approved).toBe(true);

    // Work proceeds normally.
    const mine = board.items.find((i) => i.owner === "A")!;
    expect((await a.claim(mine.id)).ok).toBe(true);
  });

  it("trivial-plan fast path auto-approves ≤2 cleanly-owned items", async () => {
    h = await startHarness();
    await h.createSession("Tiny task", { autoApproveTrivial: true });
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await b.register();

    await a.postPlan([{ title: "Frontend bit", ownerHint: "A", paths: [] }]);
    const res = await b.postPlan([{ title: "Backend bit", ownerHint: "B", paths: [] }]);
    expect(res.autoApproved).toBe(true);

    expect(((await a.status()) as { phase: string }).phase).toBe("executing");
  });
});

/** Race scenarios: simultaneous claims of the same item, concurrent plan posts,
 *  double completion. The single-writer event loop must serialize these safely.
 */
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, OAUTH_PLAN, type Harness } from "./harness.js";

let h: Harness;

afterEach(async () => {
  await h.cleanup();
});

describe("races", () => {
  it("two agents claiming the same unowned item: exactly one wins", async () => {
    h = await startHarness();
    await h.createSession("goal");
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await b.register();

    // One shared unowned item, assigned to nobody — approved via human add.
    await a.postPlan([{ title: "A work", ownerHint: "A" }]);
    await b.postPlan([{ title: "B work", ownerHint: "B" }, { title: "shared cleanup", ownerHint: null }]);
    const plan = (await a.planStatus()) as { unassigned: string[] };
    // Human assigns the shared item to A — then B's claim must lose.
    await h.human.approvePlan({ assign: { [plan.unassigned[0]]: "A" } });

    const board = (await a.getBoard()) as { items: Array<{ id: string; title: string }> };
    const shared = board.items.find((i) => i.title === "shared cleanup")!;

    const [resA, resB] = await Promise.all([a.claim(shared.id), b.claim(shared.id)]);
    const oks = [resA, resB].filter((r) => r.ok === true);
    const rejections = [resA, resB].filter((r) => r.ok === false);
    expect(oks).toHaveLength(1);
    expect(rejections).toHaveLength(1);
  });

  it("re-claim by the same claimant is idempotent", async () => {
    h = await startHarness();
    await h.createSession("goal", {
      plan: false,
      presetBoard: [
        { title: "A work", ownerHint: "A" },
        { title: "B work", ownerHint: "B" },
      ],
    });
    const a = await h.connectAgent("A");
    await a.register();
    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }> };
    const mine = board.items.find((i) => i.owner === "A")!;
    expect((await a.claim(mine.id)).ok).toBe(true);
    expect((await a.claim(mine.id)).ok).toBe(true); // no error on retry
  });

  it("concurrent plan posts from both agents merge exactly once", async () => {
    h = await startHarness();
    await h.createSession("goal");
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await b.register();

    const [resA, resB] = await Promise.all([a.postPlan(OAUTH_PLAN.fromA), b.postPlan(OAUTH_PLAN.fromB)]);
    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
    // Exactly one of the two posts triggered the merge.
    expect([resA.merged, resB.merged].filter(Boolean)).toHaveLength(1);

    const plan = (await a.planStatus()) as { proposedBoard: unknown[] };
    expect(plan.proposedBoard).toHaveLength(5);
  });

  it("double completion is idempotent, not an error", async () => {
    h = await startHarness();
    await h.createSession("goal", {
      plan: false,
      presetBoard: [
        { title: "A work", ownerHint: "A" },
        { title: "B work", ownerHint: "B" },
      ],
    });
    const a = await h.connectAgent("A");
    await a.register();
    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }> };
    const mine = board.items.find((i) => i.owner === "A")!;
    await a.claim(mine.id);
    expect((await a.complete(mine.id, ["x.ts"])).ok).toBe(true);
    expect((await a.complete(mine.id, ["x.ts"])).ok).toBe(true);
  });
});

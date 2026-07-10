/** Recovery: hub restart restores persisted state losslessly; a crashed agent's
 *  claims reopen; resume briefs carry the restart context.
 */
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, OAUTH_PLAN, type Harness } from "./harness.js";

let h: Harness;

afterEach(async () => {
  await h.cleanup();
});

describe("failure recovery", () => {
  it("hub restart mid-session: state restored, agents continue", async () => {
    h = await startHarness();
    await h.createSession("Add Google OAuth login", { mode: "checkpoint" });
    let a = await h.connectAgent("A");
    let b = await h.connectAgent("B");
    await a.register();
    await b.register();
    await a.postPlan(OAUTH_PLAN.fromA);
    await b.postPlan(OAUTH_PLAN.fromB);
    const plan = (await a.planStatus()) as { unassigned: string[] };
    await h.human.approvePlan({ assign: { [plan.unassigned[0]]: "B" } });

    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }>; boardVersion: number };
    const mineA = board.items.find((i) => i.owner === "A")!;
    await a.claim(mineA.id);
    await b.postContract("service: auth-api\nPOST /auth/google → 302", {});

    // Simulate a crash: the persist file is write-through, so stopping without
    // teardown and rebooting a fresh Hub against the same file is equivalent.
    await h.restartHub();

    a = await h.connectAgent("A");
    b = await h.connectAgent("B");

    const status = (await a.status()) as { phase: string; goal: string };
    expect(status.phase).toBe("executing");

    const restored = (await a.getBoard()) as {
      items: Array<{ id: string; status: string; claimedBy: string | null }>;
      boardVersion: number;
    };
    expect(restored.items).toHaveLength(5);
    expect(restored.boardVersion).toBe(board.boardVersion + 1); // +1 from the claim
    const claimed = restored.items.find((i) => i.id === mineA.id)!;
    expect(claimed.status).toBe("claimed");
    expect(claimed.claimedBy).toBe("A");

    const contracts = (await b.getContracts()) as { contracts: Array<{ service: string }> };
    expect(contracts.contracts[0].service).toBe("auth-api");

    // Work continues seamlessly.
    expect((await a.complete(mineA.id, [])).ok).toBe(true);
  });

  it("released agent's claims reopen and the peer can see them", async () => {
    h = await startHarness();
    await h.createSession("goal", {
      plan: false,
      presetBoard: [
        { title: "A work", ownerHint: "A" },
        { title: "B work", ownerHint: "B" },
      ],
    });
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await b.register();

    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }>; boardVersion: number };
    const mineA = board.items.find((i) => i.owner === "A")!;
    await a.claim(mineA.id);

    // Adapter reports the process died.
    const released = (await h.human.releaseAgent("A")) as { ok: boolean; reopened: string[] };
    expect(released.reopened).toEqual([mineA.id]);

    const after = (await b.getBoard(board.boardVersion)) as {
      items: Array<{ id: string; status: string; claimedBy: string | null }>;
    };
    const reopened = after.items.find((i) => i.id === mineA.id)!;
    expect(reopened.status).toBe("open");
    expect(reopened.claimedBy).toBeNull();
  });

  it("a resumed agent re-registers and gets a useful brief", async () => {
    h = await startHarness();
    await h.createSession("Add Google OAuth login", {
      plan: false,
      presetBoard: [
        { title: "Login UI", ownerHint: "A", paths: ["src/login/"] },
        { title: "Auth API", ownerHint: "B", paths: ["src/auth/"] },
      ],
    });
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await b.register();
    await b.postContract("service: auth-api\nPOST /auth/login → { token }", {});
    const board = (await b.getBoard()) as { items: Array<{ id: string; owner: string }> };
    const mineB = board.items.find((i) => i.owner === "B")!;
    await b.claim(mineB.id);
    await b.complete(mineB.id, ["src/auth/controller.ts"]);

    await h.human.releaseAgent("A");

    // The replacement agent (fresh process in the real world).
    const a2 = await h.connectAgent("A");
    expect((await a2.register()).ok).toBe(true);
    const brief = (await a2.resumeBrief()) as { brief: string };
    expect(brief.brief).toContain("Login UI"); // its remaining item
    expect(brief.brief).toContain("auth-api rev1"); // contract in force
    expect(brief.brief).toContain("src/auth/controller.ts"); // peer completion refs
  });
});

/** Acceptance scenario 1: full session — plan → merge → approval with reassignment →
 *  claims → contracts (delta reads) → checkpoint → completion rule → done.
 */
import * as fs from "fs";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, OAUTH_PLAN, type Harness } from "./harness.js";
import type { FakeAgent } from "./fakeAgent.js";

let h: Harness;
let a: FakeAgent;
let b: FakeAgent;

beforeAll(async () => {
  h = await startHarness();
  await h.createSession("Add Google OAuth login", { mode: "checkpoint" });
  a = await h.connectAgent("A");
  b = await h.connectAgent("B");
});

afterAll(async () => {
  await h.cleanup();
});

describe("happy path — plan → approve → execute → done", () => {
  it("registers both agents", async () => {
    expect((await a.register()).ok).toBe(true);
    expect((await b.register()).ok).toBe(true);
    const status = (await h.human.status()) as { agents: Array<{ id: string; registered: boolean }> };
    expect(status.agents.every((x) => x.registered)).toBe(true);
  });

  it("merges both proposals into one board with the unassigned item flagged", async () => {
    expect((await a.postPlan(OAUTH_PLAN.fromA)).ok).toBe(true);
    const res = await b.postPlan(OAUTH_PLAN.fromB);
    expect(res.ok).toBe(true);
    expect(res.merged).toBe(true);

    const plan = (await a.planStatus()) as { proposedBoard: Array<{ id: string; owner: string | null }>; unassigned: string[] };
    expect(plan.proposedBoard).toHaveLength(5);
    expect(plan.unassigned).toHaveLength(1);
  });

  it("one-click approve auto-assigns unowned items to their proposer (no human assignment needed)", async () => {
    const waitingA = a.awaitPlanApprovalUntilDecided();
    const waitingB = b.awaitPlanApprovalUntilDecided();

    // Give the held calls a moment to attach, then approve with NO assignment.
    await new Promise((r) => setTimeout(r, 150));
    const approve = await h.human.approvePlan({});
    expect(approve.ok).toBe(true); // no longer blocked on unassigned items

    const [decA, decB] = await Promise.all([waitingA, waitingB]);
    expect(decA.approved).toBe(true);
    expect(decB.approved).toBe(true);

    const status = (await a.status()) as { phase: string };
    expect(status.phase).toBe("executing");
  });

  it("agents claim their own items — every item now has an owner", async () => {
    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }> };
    expect(board.items).toHaveLength(5);
    expect(board.items.every((i) => i.owner === "A" || i.owner === "B")).toBe(true); // auto-assigned

    for (const item of board.items) {
      const claimer = item.owner === "A" ? a : b;
      expect((await claimer.claim(item.id)).ok).toBe(true);
    }
  });

  it("contracts round-trip with hash, revision, disk mirror, and delta reads", async () => {
    const posted = await b.postContract(
      "GET /auth/google/callback → { token: string, user: { id, email } }",
      { service: "auth-api", title: "Auth API v1" }
    );
    expect(posted.ok).toBe(true);
    expect(posted.revision).toBe(1);
    expect(String(posted.contentHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(h.wsB, "contracts", "auth-api.md"))).toBe(true);

    const all = (await a.getContracts()) as { contractVersion: number; contracts: unknown[] };
    expect(all.contracts).toHaveLength(1);

    // Delta read: nothing new since the current version.
    const delta = (await a.getContracts(all.contractVersion)) as { contracts: unknown[] };
    expect(delta.contracts).toHaveLength(0);

    // Revision bumps per slug.
    const rev2 = await b.postContract("GET /auth/google/callback → { token, user, expiresAt }", {
      service: "auth-api",
    });
    expect(rev2.revision).toBe(2);
  });

  it("board delta reads return only changed items", async () => {
    const before = (await a.getBoard()) as { boardVersion: number };
    await a.postUpdate("login page wired up", ["src/pages/login/LoginPage.tsx"]);
    const delta = (await a.getBoard(before.boardVersion)) as { items: unknown[] };
    expect(delta.items).toHaveLength(0); // updates don't touch the board

    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }> };
    const mine = board.items.find((i) => i.owner === "A")!;
    await a.complete(mine.id, ["src/pages/login/LoginPage.tsx"]);
    const delta2 = (await b.getBoard(before.boardVersion)) as { items: Array<{ id: string }> };
    expect(delta2.items).toHaveLength(1);
    expect(delta2.items[0].id).toBe(mine.id);
  });

  it("checkpoint pauses and resumes with feedback", async () => {
    await b.postCheckpoint("Auth API implemented", "Run users.google_id migration");
    expect(((await b.checkpointStatus()) as { status: string }).status).toBe("pending");

    const waiting = b.checkpointStatus(true); // long-poll variant
    await new Promise((r) => setTimeout(r, 100));
    await h.human.resolveCheckpoint("B", false, "add a rollback file first");
    const resolved = (await waiting) as { status: string; feedback: string };
    expect(resolved.status).toBe("feedback");
    expect(resolved.feedback).toContain("rollback");
  });

  it("resume brief reflects live state", async () => {
    const brief = (await b.resumeBrief()) as { brief: string };
    expect(brief.brief).toContain("Add Google OAuth login");
    expect(brief.brief).toContain("auth-api rev2");
    expect(brief.brief).toContain("rollback"); // latest feedback
  });

  it("enforces the completion rule, then reaches done", async () => {
    const board = (await a.getBoard()) as {
      items: Array<{ id: string; status: string; claimedBy: string | null }>;
    };
    const remaining = board.items.filter((i) => i.status === "claimed");
    expect(remaining.length).toBeGreaterThan(0);

    let last: Record<string, unknown> = {};
    for (const item of remaining) {
      const agent = item.claimedBy === "A" ? a : b;
      last = await agent.complete(item.id, []);
    }
    expect(last.sessionDone).toBe(true);
    expect(((await h.human.status()) as { phase: string }).phase).toBe("done");
  });

  it("archives on stop", async () => {
    const res = (await h.human.stop()) as { ok: boolean; archive: string | null };
    expect(res.ok).toBe(true);
    expect(res.archive && fs.existsSync(res.archive)).toBe(true);
  });
});

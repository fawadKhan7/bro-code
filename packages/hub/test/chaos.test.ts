/** Chaos agent: deliberately wrong tool usage. The hub must answer every call
 *  cheaply and never hang or corrupt state.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.js";
import type { FakeAgent } from "./fakeAgent.js";

let h: Harness;
let chaos: FakeAgent;

beforeAll(async () => {
  h = await startHarness();
  await h.createSession("goal");
  chaos = await h.connectAgent("A");
});

afterAll(async () => {
  await h.cleanup();
});

describe("chaos agent", () => {
  it("unknown agent ids are rejected with the configured id list", async () => {
    const res = await chaos.call("register_agent", { agent_id: "Z", workspace_path: "/tmp/x" });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("A, B");
  });

  it("acting before registering still gets structured answers", async () => {
    const res = await chaos.call("claim_task", { agent_id: "A", task_id: "t99" });
    expect(res.ok).toBe(false);
  });

  it("empty and oversized inputs are rejected, not crashed on", async () => {
    await chaos.register();
    expect((await chaos.postPlan([])).ok).toBe(false);
    expect((await chaos.postContract("")).ok).toBe(false);

    // Oversized title: rejected at the schema layer (zod max 200) on the primary transport.
    const long = "x".repeat(5000);
    const res = await chaos.postPlan([{ title: long, ownerHint: "A" }]);
    expect(res.ok).toBe(false);
  });

  it("unknown tool names return a structured error, never a hang", async () => {
    const result = await chaos.call("do_everything", {}).then(
      (res) => res,
      (err) => ({ ok: false, error: String(err) })
    );
    expect(result.ok).toBe(false);
    expect(String(result.error)).toBeTruthy();
  });

  it("nonsense REST payloads return 4xx JSON, not hangs", async () => {
    const res = await fetch(`${h.url}/api/plan/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });

  it("the session is still coherent after all the abuse", async () => {
    const status = (await chaos.status()) as { active: boolean; phase: string };
    expect(status.active).toBe(true);
    expect(status.phase).toBe("planning");
  });
});

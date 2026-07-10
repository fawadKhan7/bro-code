/** The /api/updates SSE event stream: connecting clients sync immediately and
 *  receive live events for registrations, plans, board changes, and phase flips.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;
let events: Array<{ type: string; data: unknown }> = [];
let abort: AbortController;

async function subscribe(url: string): Promise<void> {
  abort = new AbortController();
  const res = await fetch(`${url}/api/updates`, {
    headers: { Accept: "text/event-stream" },
    signal: abort.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstEvent: (() => void) | null = null;
  const ready = new Promise<void>((r) => (firstEvent = r));

  void (async () => {
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
        if (data) {
          events.push(JSON.parse(data) as { type: string; data: unknown });
          firstEvent?.();
          firstEvent = null;
        }
      }
    }
  })();
  await ready;
}

async function waitFor(predicate: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for event");
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  h = await startHarness();
  await h.createSession("Event stream test");
  await subscribe(h.url);
});

afterAll(async () => {
  abort.abort();
  await h.cleanup();
});

describe("SSE event stream", () => {
  it("sends a status snapshot on connect", () => {
    expect(events[0]?.type).toBe("status");
  });

  it("pushes registration, plan, phase, and board events live", async () => {
    const a = await h.connectAgent("A");
    const b = await h.connectAgent("B");
    await a.register();
    await waitFor(() => events.some((e) => e.type === "registration"));

    await b.register();
    await a.postPlan([{ title: "A part", ownerHint: "A" }]);
    await b.postPlan([{ title: "B part", ownerHint: "B" }, { title: "B extra", ownerHint: "B" }]);
    await waitFor(() => events.filter((e) => e.type === "plan").length >= 2);

    await h.human.approvePlan({});
    await waitFor(() =>
      events.some((e) => e.type === "phase" && (e.data as { phase: string }).phase === "executing")
    );

    const board = (await a.getBoard()) as { items: Array<{ id: string; owner: string }> };
    await a.claim(board.items.find((i) => i.owner === "A")!.id);
    await waitFor(() => events.some((e) => e.type === "board" && (e.data as { claimed?: string }).claimed));
  });
});

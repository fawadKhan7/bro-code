/** The chat section: user ↔ agent messages over REST + MCP, targeting rules,
 *  long-poll wakes, SSE broadcast, and persistence across a hub restart.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.js";
import type { FakeAgent } from "./fakeAgent.js";

interface ChatMsg {
  id: number;
  from: string;
  to: string;
  text: string;
}

let h: Harness;
let a: FakeAgent;
let b: FakeAgent;
const events: Array<{ type: string; data: unknown }> = [];
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
        if (data) events.push(JSON.parse(data) as { type: string; data: unknown });
      }
    }
  })();
}

beforeAll(async () => {
  h = await startHarness();
  await h.createSession("Chat test session");
  a = await h.connectAgent("A");
  b = await h.connectAgent("B");
  await a.register();
  await b.register();
  await subscribe(h.url);
});

afterAll(async () => {
  abort.abort();
  await h.cleanup();
});

describe("chat", () => {
  it("rejects an empty message and unknown recipients", async () => {
    const empty = await h.human.sendChat("   ");
    expect(empty.ok).toBe(false);
    const unknown = await h.human.sendChat("hello", "Z");
    expect(unknown.ok).toBe(false);
    expect(String(unknown.error)).toContain('"Z"');
  });

  it("delivers a user message to agents via get_chat", async () => {
    const sent = await h.human.sendChat("hello both — remember to write tests");
    expect(sent.ok).toBe(true);

    const seenByA = (await a.getChat()) as { messages: ChatMsg[] };
    const msg = seenByA.messages.find((m) => m.from === "user");
    expect(msg?.text).toContain("write tests");
    expect(msg?.to).toBe("all");
  });

  it("routes agent replies to the user in the shared transcript", async () => {
    const res = await a.postChat("On it. I'll start with the login page.");
    expect(res.ok).toBe(true);

    const transcript = (await h.human.getChat()) as { messages: ChatMsg[] };
    const reply = transcript.messages.find((m) => m.from === "A");
    expect(reply?.to).toBe("user"); // agents always talk to the user
    expect(reply?.text).toContain("login page");
  });

  it("returns only new messages with since_id", async () => {
    const all = (await h.human.getChat()) as { chatVersion: number; messages: ChatMsg[] };
    expect(all.messages.length).toBeGreaterThanOrEqual(2);
    const latest = all.chatVersion;

    await h.human.sendChat("one more thing", "B");
    const delta = (await h.human.getChat(latest)) as { messages: ChatMsg[] };
    expect(delta.messages).toHaveLength(1);
    expect(delta.messages[0].to).toBe("B");
  });

  it("broadcasts chat SSE events", () => {
    const chatEvents = events.filter((e) => e.type === "chat");
    expect(chatEvents.length).toBeGreaterThanOrEqual(3);
  });

  it("wakes a waiting agent when a message for it arrives — and not the other agent", async () => {
    const current = ((await h.human.getChat()) as { chatVersion: number }).chatVersion;

    const bWait = b.getChat(current, true);
    const aWait = a.getChat(current, true);
    setTimeout(() => void h.human.sendChat("B: please add pagination", "B"), 100);

    const forB = (await bWait) as { messages: ChatMsg[] };
    expect(forB.messages.map((m) => m.text)).toContain("B: please add pagination");

    // A's long-poll is not woken by a message directed at B — it times out with retry.
    const forA = (await aWait) as { messages: ChatMsg[]; pending?: boolean; retry?: boolean };
    expect(forA.pending).toBe(true);
    expect(forA.retry).toBe(true);
    expect(forA.messages).toHaveLength(0);
  });

  it("does not wake an agent's wait with its own message", async () => {
    const current = ((await h.human.getChat()) as { chatVersion: number }).chatVersion;
    const wait = a.getChat(current, true);
    setTimeout(() => void a.postChat("thinking out loud"), 100);
    const res = (await wait) as { pending?: boolean };
    expect(res.pending).toBe(true);
  });

  it("ask mode is a live chat toggle: sets mode and announces it to all agents", async () => {
    const before = ((await h.human.getChat()) as { chatVersion: number }).chatVersion;
    const on = await h.human.setMode("ask");
    expect(on.ok).toBe(true);
    expect((on as { mode: string }).mode).toBe("ask");

    const status = (await h.human.status()) as { mode: string };
    expect(status.mode).toBe("ask");

    const chat = (await h.human.getChat(before)) as { messages: ChatMsg[] };
    const announce = chat.messages.find((m) => m.from === "user" && m.to === "all" && /Ask mode is ON/.test(m.text));
    expect(announce).toBeTruthy();

    const off = await h.human.setMode("auto-run");
    expect(off.ok).toBe(true);
    expect(((await h.human.status()) as { mode: string }).mode).toBe("auto-run");
  });

  it("rejects an unknown mode", async () => {
    const res = await h.human.setMode("turbo");
    expect(res.ok).toBe(false);
  });

  it("survives a hub restart", async () => {
    const before = (await h.human.getChat()) as { messages: ChatMsg[] };
    await h.restartHub();
    const after = (await h.human.getChat()) as { messages: ChatMsg[] };
    expect(after.messages).toEqual(before.messages);
  });
});

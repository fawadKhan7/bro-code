/** Continuing a session through chat: agents finish and exit, the user sends a chat message,
 *  and the supervisor wakes the right agents back up with a follow-up prompt. Zero AI tokens.
 */
import { afterEach, describe, expect, it } from "vitest";
import { bootHub, teardown, waitForPhase, finishOwned, type BootedHub } from "./hubHarness.js";
import { ScriptedAdapter, type AgentScript } from "./scriptedAgent.js";

interface ChatMsg {
  id: number;
  from: string;
  to: string;
  text: string;
}

let booted: BootedHub | undefined;

afterEach(async () => {
  await teardown(booted);
  booted = undefined;
});

/** Initial run: do the assigned board item, tell the user, exit. */
const worker: AgentScript = async (c) => {
  await c.register();
  await finishOwned(c);
  await c.postChat(`Agent ${c.id} here — my part is done.`);
};

/** Finishes its board items but never exits — simulates an agent lingering on a spawned
 *  dev server after the session is done. */
const workerLingering: AgentScript = async (c) => {
  await c.register();
  await finishOwned(c);
  await c.postChat(`Agent ${c.id} here — my part is done. The API server is running.`);
  await new Promise(() => undefined); // hang forever (process never exits)
};

/** Woken by a user chat message: read the chat, act, reply. */
const followUp: AgentScript = async (c) => {
  await c.register();
  const chat = (await c.getChat()) as { messages: ChatMsg[] };
  const ask = chat.messages.filter((m) => m.from === "user").pop();
  await c.postChat(`Agent ${c.id}: handled "${ask?.text ?? "?"}".`);
};

/** Registers, finishes its work, then hangs forever WITHOUT finishing its board item — keeps the
 *  session in `executing` (not done) so a peer can exit cleanly mid-session. */
const idleUnfinished: AgentScript = async (c) => {
  await c.register();
  await new Promise(() => undefined);
};

async function waitForChat(
  predicate: (messages: ChatMsg[]) => boolean,
  ms = 6000
): Promise<ChatMsg[]> {
  const start = Date.now();
  for (;;) {
    const chat = (await booted!.client.chat()) as unknown as { messages: ChatMsg[] };
    if (predicate(chat.messages)) return chat.messages;
    if (Date.now() - start > ms) throw new Error("timed out waiting for chat messages");
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** Scripted exits are signaled ~20ms after the script returns — settle before chatting. */
const settle = () => new Promise((r) => setTimeout(r, 300));

describe("continuing a session through chat", () => {
  it("a broadcast message after 'done' wakes every agent with the follow-up prompt", async () => {
    const adapter = new ScriptedAdapter({
      scripts: { A: worker, B: worker },
      resumeScripts: { A: followUp, B: followUp },
    });
    booted = await bootHub(adapter);
    const start = await booted.client.startSession({ goal: "Build the widget", plan: false });
    expect(start.ok).toBe(true);
    await waitForPhase(booted.client, "done");
    await settle();

    const sent = await booted.client.sendChat("Great work — now also add dark mode.");
    expect(sent.ok).toBe(true);

    const messages = await waitForChat(
      (msgs) =>
        msgs.some((m) => m.from === "A" && m.text.includes("dark mode")) &&
        msgs.some((m) => m.from === "B" && m.text.includes("dark mode"))
    );
    expect(messages.filter((m) => m.from === "user")).toHaveLength(1);

    // The wake-up prompt embeds the user's message and the follow-up instructions.
    const wakePrompts = adapter.configureCalls.slice(2).map((c) => c.kickoffPrompt);
    expect(wakePrompts).toHaveLength(2);
    for (const prompt of wakePrompts) {
      expect(prompt).toContain("add dark mode");
      expect(prompt).toContain("get_chat");
      expect(prompt).toContain("post_chat");
      expect(prompt).toContain("STAY in the conversation"); // chat session, not a one-off errand
    }
  });

  it("a directed message wakes only that agent — resuming its previous AI session", async () => {
    const adapter = new ScriptedAdapter({
      scripts: { A: worker, B: worker },
      resumeScripts: { A: followUp, B: followUp },
      sessionRefs: true,
    });
    booted = await bootHub(adapter);
    await booted.client.startSession({ goal: "Build the widget", plan: false });
    await waitForPhase(booted.client, "done");
    await settle();

    await booted.client.sendChat("B, please rename the endpoint.", "B");
    const messages = await waitForChat((msgs) =>
      msgs.some((m) => m.from === "B" && m.text.includes("rename the endpoint"))
    );
    expect(messages.some((m) => m.from === "A" && m.text.includes("rename"))).toBe(false);
    // Only B was relaunched: two initial launches + one wake.
    expect(adapter.configureCalls).toHaveLength(3);
    expect(adapter.configureCalls[2].agent.id).toBe("B");
    // The wake resumes B's previous AI session (memory), captured from its first run.
    expect(adapter.configureCalls[2].resumeSessionRef).toBe("sess-B-1");
    expect(adapter.configureCalls[0].resumeSessionRef).toBeUndefined();
  });

  it("wakes an agent that exited mid-session before reading a message directed at it", async () => {
    // A finishes its item and, still running, waits on a gate; B never finishes so the session
    // stays in `executing`. The user messages A while A is running (so deliverUserMessage expects
    // A to read it via get_chat) — then A exits without reading. handleExit must wake A so the
    // message isn't silently dropped (and the chat indicator has something to show meanwhile).
    let releaseA: () => void = () => undefined;
    const gate = new Promise<void>((r) => (releaseA = r));
    const workerThenExit: AgentScript = async (c) => {
      await c.register();
      await finishOwned(c);
      await c.postChat(`Agent ${c.id} here — my part is done.`);
      await gate; // stay alive until the test has sent its message, then exit WITHOUT reading it
    };

    const adapter = new ScriptedAdapter({
      scripts: { A: workerThenExit, B: idleUnfinished },
      resumeScripts: { A: followUp, B: followUp },
    });
    booted = await bootHub(adapter);
    await booted.client.startSession({ goal: "Build the widget", plan: false });
    // Wait until A has posted "done" (A is now parked on the gate, still running).
    await waitForChat((msgs) => msgs.some((m) => m.from === "A" && m.text.includes("my part is done")));

    const sent = await booted.client.sendChat("A, please also add a spinner.", "A");
    expect(sent.ok).toBe(true);
    await settle();
    releaseA(); // A exits now, without ever having read the message

    const messages = await waitForChat((msgs) =>
      msgs.some((m) => m.from === "A" && m.text.includes("add a spinner"))
    );
    expect(messages.some((m) => m.from === "A" && m.text.includes("add a spinner"))).toBe(true);
    // A relaunched exactly once for the wake (initial A + initial B + one A wake).
    expect(adapter.configureCalls.filter((c) => c.agent.id === "A")).toHaveLength(2);
  });

  it("after 'done', a lingering agent process (e.g. spawned server) is stopped and woken", async () => {
    const adapter = new ScriptedAdapter({
      scripts: { A: worker, B: workerLingering },
      resumeScripts: { A: followUp, B: followUp },
    });
    booted = await bootHub(adapter);
    await booted.client.startSession({ goal: "Build the widget", plan: false });
    await waitForPhase(booted.client, "done");
    await settle();

    // B's process is still "running" (hung on its fake server) — the message must still reach it.
    await booted.client.sendChat("did you seed the data? in the database?", "B");
    await waitForChat((msgs) =>
      msgs.some((m) => m.from === "B" && m.text.includes("did you seed the data"))
    );
    expect(adapter.configureCalls).toHaveLength(3);
    expect(adapter.configureCalls[2].agent.id).toBe("B");
  });
});

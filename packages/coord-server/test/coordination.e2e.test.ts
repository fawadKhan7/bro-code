/** End to end over real sockets: two humans, two agents, one session.
 *
 *  This is the test that proves the three rights hold together — a human commands
 *  only their own agent, both humans observe everything, and work crossing to the
 *  other agent arrives only through the approval handshake. No agent has a role:
 *  each is simply the agent of the user it connects as.
 */
import "reflect-metadata";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import {
  CoordClient,
  type ActivityPayload,
  type CommandPayload,
  type ContractPayload,
  type Envelope,
  type HandshakeAuth,
  type SessionSnapshot,
} from "@duo/coord-client";
import { AppModule } from "../src/app.module.js";

const CONTRACT: ContractPayload = {
  endpoint: "/v2/auth",
  method: "POST",
  requestSchema: { email: "string", password: "string" },
  responseSchema: { token: "string" },
  version: "2.0.0",
  breaking: true,
};

async function waitFor<T>(probe: () => T | undefined | null | false, label: string, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("coordination server (e2e)", () => {
  let app: INestApplication;
  let url: string;

  const clients: CoordClient[] = [];
  let coffee: CoordClient; // human
  let coffeeAgent: CoordClient; // coffee's agent
  let friend: CoordClient; // human
  let friendAgent: CoordClient; // friend's agent

  /** Everything each client saw, so assertions can look at the observable record. */
  const seen = {
    coffeeAgentCommands: [] as Envelope<CommandPayload>[],
    friendAgentCommands: [] as Envelope<CommandPayload>[],
    friendAgentContracts: [] as ContractPayload[],
    coffeeActivity: [] as ActivityPayload[],
    friendActivity: [] as ActivityPayload[],
  };
  let coffeeSnapshot: SessionSnapshot | null = null;
  let friendSnapshot: SessionSnapshot | null = null;

  const connect = async (auth: HandshakeAuth): Promise<CoordClient> => {
    const client = new CoordClient({ url, auth, heartbeatIntervalMs: 1_000, ackTimeoutMs: 4_000 });
    await client.connect();
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const port = (app.getHttpServer().address() as AddressInfo).port;
    url = `http://127.0.0.1:${port}`;

    coffee = await connect({ userId: "coffee", displayName: "Coffee", role: "human" });
    coffeeAgent = await connect({ userId: "coffee", displayName: "Coffee", role: "agent" });
    friend = await connect({ userId: "friend", displayName: "Friend", role: "human" });
    friendAgent = await connect({ userId: "friend", displayName: "Friend", role: "agent" });

    coffeeAgent.on("command", ({ envelope }) => seen.coffeeAgentCommands.push(envelope));
    friendAgent.on("command", ({ envelope }) => seen.friendAgentCommands.push(envelope));
    friendAgent.on("contract", ({ payload }) => seen.friendAgentContracts.push(payload));
    coffee.on("activity", ({ payload }) => seen.coffeeActivity.push(payload));
    friend.on("activity", ({ payload }) => seen.friendActivity.push(payload));
    coffee.on("snapshot", (snapshot) => (coffeeSnapshot = snapshot));
    friend.on("snapshot", (snapshot) => (friendSnapshot = snapshot));
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await app?.close();
  });

  it("puts both users on one network roster", async () => {
    // Both humans, and both of their agent processes, are attached.
    const roster = await waitFor(
      () => (coffee.roster.length >= 2 && coffee.roster.every((entry) => entry.agentOnline) ? coffee.roster : null),
      "roster with both agents attached",
    );
    expect(roster.map((entry) => entry.userId).sort()).toEqual(["coffee", "friend"]);
    expect(roster.every((entry) => entry.state === "available")).toBe(true);
  });

  it("pairs the two users through the connect handshake", async () => {
    let incoming: { requestId: string; fromUser: string } | null = null;
    friend.on("connect-request", ({ payload }) => (incoming = payload));

    await coffee.requestConnect("friend");

    const request = await waitFor(() => incoming, "connect-request at friend");
    expect(request.fromUser).toBe("coffee");

    // Soft-locked while in flight — nobody else can grab either of them.
    await waitFor(() => coffee.roster.every((entry) => entry.state === "pending") || null, "both pending");

    await friend.respondConnect(request.requestId, "approve", "coffee");

    const session = await waitFor(() => coffee.session, "session at coffee");
    const mirrored = await waitFor(() => friend.session, "session at friend");
    expect(session.sessionId).toBe(mirrored.sessionId);
    expect(session.participants.sort()).toEqual(["coffee", "friend"]);

    await waitFor(() => coffee.roster.every((entry) => entry.state === "reserved") || null, "both reserved");
  });

  it("queues a command and dispatches it to the issuer's own agent", async () => {
    const ack = await coffee.sendCommand({
      intent: "add POST /v2/auth",
      scope: ["src/auth.service.ts"],
      priority: "normal",
    });
    expect(ack.status).toBe("queued");
    expect(ack.queuePosition).toBe(1);

    const dispatched = await waitFor(() => seen.coffeeAgentCommands[0], "command at coffee's agent");
    expect(dispatched.payload.intent).toBe("add POST /v2/auth");
    // The partner's agent must never see it.
    expect(seen.friendAgentCommands).toHaveLength(0);
  });

  it("holds the second command until the first one finishes — one at a time", async () => {
    const ack = await coffee.sendCommand({
      intent: "add rate limiting",
      scope: ["src/limiter.ts"],
      priority: "normal",
    });
    expect(ack.status).toBe("queued");
    expect(ack.queuePosition).toBe(2);

    // A second commander can see a task is already running, on the bus.
    await waitFor(
      () => seen.friendActivity.some((a) => a.currentAction.includes("a task is already running")) || null,
      "queue-depth activity on the bus",
    );
    expect(seen.coffeeAgentCommands).toHaveLength(1);

    const first = seen.coffeeAgentCommands[0];
    await coffeeAgent.reportActivity({
      status: "completed",
      task: "add POST /v2/auth",
      currentAction: "done",
      filesTouched: ["src/auth.service.ts"],
      commandId: first.id,
    });

    const second = await waitFor(() => seen.coffeeAgentCommands[1], "second command dispatched");
    expect(second.payload.intent).toBe("add rate limiting");

    await coffeeAgent.reportActivity({
      status: "completed",
      task: "add rate limiting",
      currentAction: "done",
      filesTouched: [],
      commandId: second.id,
    });
    await waitFor(() => (coffeeSnapshot?.locks.length === 0 ? true : null), "locks released on completion");
  });

  it("refuses a human commanding the partner's agent", async () => {
    const ack = await coffee.sendCommand({ intent: "restyle the login form", scope: [], priority: "normal" }, "friend");
    expect(ack.status).toBe("denied");
    expect(ack.reason).toContain("cross-agent request");
    expect(seen.friendAgentCommands).toHaveLength(0);
  });

  it("lets both humans observe both agents", async () => {
    await friendAgent.reportActivity({
      status: "progress",
      task: "build login form",
      currentAction: "editing LoginForm.tsx",
      filesTouched: ["ui/LoginForm.tsx"],
    });

    // Coffee sees friend's agent working, unfiltered.
    await waitFor(
      () => seen.coffeeActivity.some((a) => a.currentAction === "editing LoginForm.tsx") || null,
      "the partner's agent activity observed by coffee",
    );
    await waitFor(
      () => coffeeSnapshot?.activity.some((entry) => entry.agent === "friend") || null,
      "the partner's agent activity in coffee's snapshot",
    );
  });

  it("routes cross-agent work through the approval inbox, never straight to the queue", async () => {
    await friendAgent.proposeToPeer("coffee", {
      requestId: "req-auth",
      summary: "login form should POST to /v2/auth",
      blocking: true,
      proposedContract: CONTRACT,
    });

    // Both dashboards see the proposal; the backend queue does not move.
    const pending = await waitFor(
      () => coffeeSnapshot?.approvals.find((approval) => approval.requestId === "req-auth"),
      "proposal in the receiving owner's inbox",
    );
    expect(pending.from).toBe("friend");
    expect(pending.to).toBe("coffee");
    expect(await waitFor(() => friendSnapshot?.approvals.length, "proposal visible to the requester too")).toBe(1);
    expect(seen.coffeeAgentCommands).toHaveLength(2);

    // The requesting side cannot approve its own ask.
    const selfApproval = await friend.resolveRequest("friend", { requestId: "req-auth", decision: "accept" });
    expect(selfApproval.status).toBe("denied");
    expect(seen.coffeeAgentCommands).toHaveLength(2);

    await coffee.resolveRequest("friend", { requestId: "req-auth", decision: "accept" });

    const converted = await waitFor(() => seen.coffeeAgentCommands[2], "approved request became a command for coffee's agent");
    expect(converted.payload.intent).toBe("login form should POST to /v2/auth");
    expect(converted.payload.scope).toEqual(["contract:POST /v2/auth"]);
    expect(converted.payload.priority).toBe("urgent");
    await waitFor(() => (coffeeSnapshot?.approvals.length === 0 ? true : null), "inbox cleared");

    await coffeeAgent.reportActivity({
      status: "completed",
      task: "auth contract",
      currentAction: "done",
      filesTouched: [],
      commandId: converted.id,
    });
  });

  it("broadcasts a contract change to the other agent", async () => {
    await coffeeAgent.publishContract(CONTRACT);

    const received = await waitFor(() => seen.friendAgentContracts[0], "contract at the peer agent");
    expect(received.endpoint).toBe("/v2/auth");
    expect(received.breaking).toBe(true);
    expect(await waitFor(() => friendSnapshot?.contracts.length, "contract in the snapshot")).toBe(1);
  });

  it("leases resources and denies the other agent while held", async () => {
    const granted = await coffeeAgent.acquireLock("shared/openapi.yaml", 60_000);
    expect(granted.status).toBe("granted");

    const denied = await friendAgent.acquireLock("shared/openapi.yaml", 60_000);
    expect(denied.status).toBe("denied");
    expect(denied.reason).toContain("coffee");

    // Both humans can see who holds what.
    const held = await waitFor(() => friendSnapshot?.locks.find((lock) => lock.resource === "shared/openapi.yaml"), "held lock");
    expect(held.holder).toBe("coffee");

    expect((await coffeeAgent.releaseLock("shared/openapi.yaml")).status).toBe("granted");
    expect((await friendAgent.acquireLock("shared/openapi.yaml", 60_000)).status).toBe("granted");
    await friendAgent.releaseLock("shared/openapi.yaml");
  });

  it("rejects a malformed envelope instead of routing it", async () => {
    const ack = await coffee.send("command", "coffee", { intent: "", scope: [], priority: "normal" } as never);
    expect(ack.status).toBe("denied");
  });

  it("ends the session and returns both users to available", async () => {
    await coffee.endSession();

    await waitFor(() => (coffee.session === null && friend.session === null ? true : null), "session cleared on both sides");
    await waitFor(() => coffee.roster.every((entry) => entry.state === "available") || null, "both available again");
    await waitFor(() => (coffeeSnapshot === null ? true : null), "snapshot cleared");

    // Nothing development-related flows outside a session.
    const ack = await coffee.sendCommand({ intent: "keep going", scope: [], priority: "normal" });
    expect(ack.status).toBe("denied");
  });
});

/** Presence + pairing: exclusivity, the soft-lock, timeout, reciprocal auto-accept. */
import { describe, expect, it, beforeEach } from "vitest";
import { PresenceService } from "../src/presence/presence.service.js";
import { PairingService } from "../src/pairing/pairing.service.js";
import { SessionRegistry } from "../src/session/session.registry.js";
import type { Connection } from "../src/session/session.types.js";

function connection(userId: string, networkId = "lan:192.168.1"): Connection {
  return { socketId: `sock-${userId}`, userId, displayName: userId, role: "human", networkId };
}

describe("pairing", () => {
  let registry: SessionRegistry;
  let presence: PresenceService;
  let pairing: PairingService;

  beforeEach(() => {
    registry = new SessionRegistry();
    presence = new PresenceService(registry);
    pairing = new PairingService(presence, registry);
    for (const conn of [connection("coffee"), connection("friend"), connection("carol")]) {
      registry.addConnection(conn);
      presence.register(conn);
    }
  });

  it("starts everyone available and visible to their own network only", () => {
    expect(presence.roster("lan:192.168.1").map((r) => r.userId)).toEqual(["carol", "coffee", "friend"]);
    expect(presence.roster("lan:10.0.0")).toEqual([]);
    expect(presence.stateOf("coffee")).toBe("available");
  });

  it("soft-locks both ends on a connect request", () => {
    const outcome = pairing.request("coffee", "friend", "req-1");
    expect(outcome.ok).toBe(true);
    expect(presence.stateOf("coffee")).toBe("pending");
    expect(presence.stateOf("friend")).toBe("pending");
  });

  it("refuses a third party mid-handshake — from either side", () => {
    pairing.request("coffee", "friend", "req-1");

    const atInvitee = pairing.request("carol", "friend", "req-2");
    expect(atInvitee).toMatchObject({ ok: false });
    expect((atInvitee as { reason: string }).reason).toContain("pending");

    const atRequester = pairing.request("carol", "coffee", "req-3");
    expect(atRequester).toMatchObject({ ok: false });
  });

  it("opens a session on approve and reserves both users", () => {
    pairing.request("coffee", "friend", "req-1");
    const outcome = pairing.respond("req-1", "approve", "friend");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.decision !== "approve") throw new Error("expected approval");
    // An agent is its owner: the participant list is the whole agent roster.
    expect(outcome.session.participants).toEqual(["coffee", "friend"]);
    expect(presence.stateOf("coffee")).toBe("reserved");
    expect(presence.get("coffee")?.partnerId).toBe("friend");

    // Third-party view: reserved, Connect disabled.
    const seen = presence.roster("lan:192.168.1").find((r) => r.userId === "friend");
    expect(seen?.state).toBe("reserved");
    expect(pairing.request("carol", "friend", "req-9")).toMatchObject({ ok: false });
  });

  it("only the invited user can answer", () => {
    pairing.request("coffee", "friend", "req-1");
    expect(pairing.respond("req-1", "approve", "carol")).toMatchObject({ ok: false });
    expect(pairing.respond("req-1", "approve", "coffee")).toMatchObject({ ok: false });
  });

  it("returns both users to available on reject", () => {
    pairing.request("coffee", "friend", "req-1");
    pairing.respond("req-1", "reject", "friend");
    expect(presence.stateOf("coffee")).toBe("available");
    expect(presence.stateOf("friend")).toBe("available");
    expect(registry.sessionOf("coffee")).toBeUndefined();
  });

  it("auto-rejects on timeout and frees both", () => {
    pairing.request("coffee", "friend", "req-1");
    const timedOut: string[] = [];
    pairing.onTimeout((request) => timedOut.push(request.requestId));

    pairing.expire("req-1");

    expect(timedOut).toEqual(["req-1"]);
    expect(presence.stateOf("coffee")).toBe("available");
    expect(presence.stateOf("friend")).toBe("available");
    // A timed-out request is gone, not merely stale.
    expect(pairing.respond("req-1", "approve", "friend")).toMatchObject({ ok: false });
  });

  it("auto-accepts reciprocal requests — both wanted it", () => {
    pairing.request("coffee", "friend", "req-1");
    const outcome = pairing.request("friend", "coffee", "req-2");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== "auto-accepted") throw new Error("expected auto-accept");
    expect(presence.stateOf("coffee")).toBe("reserved");
    expect(presence.stateOf("friend")).toBe("reserved");
    expect(registry.sessionOf("coffee")?.sessionId).toBe(outcome.session.sessionId);
  });

  it("keeps discovery network-scoped", () => {
    const remote = connection("dave", "lan:10.0.0");
    registry.addConnection(remote);
    presence.register(remote);

    const outcome = pairing.request("coffee", "dave", "req-1");
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { reason: string }).reason).toContain("not on your network");
  });

  it("refuses connecting to yourself", () => {
    expect(pairing.request("coffee", "coffee", "req-1")).toMatchObject({ ok: false });
  });

  it("tears the session down when a partner drops, freeing the other", () => {
    pairing.request("coffee", "friend", "req-1");
    pairing.respond("req-1", "approve", "friend");

    const { ended } = pairing.handleDrop("coffee");
    expect(ended?.reason).toBe("partner_dropped");
    expect(presence.stateOf("friend")).toBe("available");
    expect(registry.sessionOf("friend")).toBeUndefined();
  });

  it("marks users offline after missed heartbeats and tears down their session", () => {
    pairing.request("coffee", "friend", "req-1");
    pairing.respond("req-1", "approve", "friend");

    const dropped: string[] = [];
    presence.onOffline((userId) => dropped.push(userId));

    // 'friend' keeps beating; 'coffee' has not beaten since registration.
    const later = Date.now() + 20_000;
    presence.beat("friend", later);
    const stale = presence.sweep(later);
    expect(stale).toContain("coffee");
    expect(dropped).toContain("coffee");
    expect(presence.stateOf("coffee")).toBe("offline");

    pairing.handleDrop("coffee");
    expect(presence.stateOf("friend")).toBe("available");
  });

  it("refuses a request from a user who is already in a session", () => {
    pairing.request("coffee", "friend", "req-1");
    pairing.respond("req-1", "approve", "friend");
    expect(pairing.request("coffee", "carol", "req-2")).toMatchObject({ ok: false });
  });
});

/** The approve right: a cross-agent request is a proposal until the owner of the
 *  receiving agent accepts it. */
import { describe, expect, it, beforeEach } from "vitest";
import type { ContractPayload } from "@duo/coord-client";
import { HandshakeService } from "../src/handshake/handshake.service.js";
import { SessionRegistry } from "../src/session/session.registry.js";

const CONTRACT: ContractPayload = {
  endpoint: "/v2/auth",
  method: "POST",
  requestSchema: { email: "string", password: "string" },
  responseSchema: { token: "string" },
  version: "2.0.0",
  breaking: true,
};

describe("handshake engine", () => {
  let registry: SessionRegistry;
  let handshake: HandshakeService;
  let sessionId: string;

  beforeEach(() => {
    registry = new SessionRegistry();
    const session = registry.open("coffee", "friend", "lan:192.168.1");
    sessionId = session.sessionId;
    handshake = new HandshakeService(registry);
  });

  const propose = (requestId = "r1", blocking = false) =>
    handshake.receive(sessionId, "friend", "coffee", {
      requestId,
      summary: "login form should POST to /v2/auth",
      blocking,
      proposedContract: CONTRACT,
    });

  it("parks a request in the receiving agent's inbox without executing it", () => {
    expect(propose().ok).toBe(true);
    const pending = handshake.pending(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ requestId: "r1", from: "friend", to: "coffee" });
  });

  it("refuses a request to your own agent", () => {
    const outcome = handshake.receive(sessionId, "coffee", "coffee", { requestId: "r1", summary: "x", blocking: false });
    expect(outcome).toMatchObject({ ok: false });
  });

  it("refuses a duplicate requestId", () => {
    propose("r1");
    expect(propose("r1")).toMatchObject({ ok: false });
  });

  it("lets only the receiving agent's owner decide", () => {
    propose();

    // 'friend' sent the request — they cannot approve their own ask.
    const wrong = handshake.resolve(sessionId, { requestId: "r1", decision: "accept" }, "friend");
    expect(wrong).toMatchObject({ ok: false });
    expect((wrong as { reason: string }).reason).toContain("coffee");

    // The proposal is still pending — a refused approval changes nothing.
    expect(handshake.pending(sessionId)).toHaveLength(1);

    const right = handshake.resolve(sessionId, { requestId: "r1", decision: "accept" }, "coffee");
    expect(right.ok).toBe(true);
  });

  it("turns an accepted proposal into a command scoped to the contract", () => {
    propose();
    const outcome = handshake.resolve(sessionId, { requestId: "r1", decision: "accept" }, "coffee");

    if (!outcome.ok || outcome.decision !== "accept") throw new Error("expected accept");
    expect(outcome.command).toEqual({
      intent: "login form should POST to /v2/auth",
      scope: ["contract:POST /v2/auth"],
      priority: "normal",
    });
    expect(handshake.pending(sessionId)).toHaveLength(0);
  });

  it("marks a blocking request urgent — the peer agent is waiting on it", () => {
    propose("r1", true);
    const outcome = handshake.resolve(sessionId, { requestId: "r1", decision: "accept" }, "coffee");
    if (!outcome.ok || outcome.decision !== "accept") throw new Error("expected accept");
    expect(outcome.command.priority).toBe("urgent");
  });

  it("applies a counter-proposal on accept", () => {
    propose();
    const outcome = handshake.resolve(
      sessionId,
      {
        requestId: "r1",
        decision: "accept",
        counterProposal: { summary: "use /v2/session instead", proposedContract: { ...CONTRACT, endpoint: "/v2/session" } },
      },
      "coffee",
    );

    if (!outcome.ok || outcome.decision !== "accept") throw new Error("expected accept");
    expect(outcome.command.intent).toBe("use /v2/session instead");
    expect(outcome.command.scope).toEqual(["contract:POST /v2/session"]);
  });

  it("produces no command on reject or renegotiate", () => {
    propose();
    const rejected = handshake.resolve(sessionId, { requestId: "r1", decision: "reject", reason: "v1 is fine" }, "coffee");
    expect(rejected).toMatchObject({ ok: true, decision: "reject" });
    expect(rejected).not.toHaveProperty("command");
    expect(handshake.pending(sessionId)).toHaveLength(0);

    propose("r2");
    const renegotiated = handshake.resolve(sessionId, { requestId: "r2", decision: "renegotiate" }, "coffee");
    expect(renegotiated).toMatchObject({ ok: true, decision: "renegotiate" });
  });

  it("forgets everything when the session ends", () => {
    propose();
    handshake.disposeSession(sessionId);
    expect(handshake.pending(sessionId)).toHaveLength(0);
  });
});

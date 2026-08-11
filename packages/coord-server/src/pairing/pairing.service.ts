/** The pairing manager: connect-request -> connect-response -> session-established.
 *
 *  Owns 1:1 exclusivity, the `pending` soft-lock, the 30s timeout, and the
 *  reciprocal-request auto-accept. It decides; the caller does the broadcasting.
 */
import { Injectable, Logger } from "@nestjs/common";
import { CONNECT_REQUEST_TIMEOUT_MS, type HumanId } from "@duo/coord-client";
import { PresenceService } from "../presence/presence.service.js";
import { SessionRegistry } from "../session/session.registry.js";
import type { Session } from "../session/session.types.js";

export interface PendingRequest {
  requestId: string;
  from: HumanId;
  fromDisplayName: string;
  to: HumanId;
  createdAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

export type RequestOutcome =
  | { ok: false; reason: string }
  | { ok: true; kind: "sent"; request: PendingRequest }
  /** Both sides asked for each other at the same time — both wanted it. */
  | { ok: true; kind: "auto-accepted"; session: Session; requestIds: string[] };

export type RespondOutcome =
  | { ok: false; reason: string }
  | { ok: true; decision: "approve"; session: Session; request: PendingRequest }
  | { ok: true; decision: "reject"; request: PendingRequest };

export interface EndedSession {
  session: Session;
  reason: "ended" | "rejected" | "timeout" | "partner_dropped";
}

@Injectable()
export class PairingService {
  private readonly log = new Logger("Pairing");
  private readonly requests = new Map<string, PendingRequest>();
  /** Soft-lock index: a user involved in any in-flight handshake. */
  private readonly requestByUser = new Map<HumanId, string>();
  private readonly timeoutHandlers = new Set<(request: PendingRequest) => void>();

  constructor(
    private readonly presence: PresenceService,
    private readonly registry: SessionRegistry,
  ) {}

  onTimeout(handler: (request: PendingRequest) => void): () => void {
    this.timeoutHandlers.add(handler);
    return () => this.timeoutHandlers.delete(handler);
  }

  pendingFor(userId: HumanId): PendingRequest | undefined {
    const requestId = this.requestByUser.get(userId);
    return requestId ? this.requests.get(requestId) : undefined;
  }

  // -- request --------------------------------------------------------------

  request(from: HumanId, to: HumanId, requestId: string, timeoutMs = CONNECT_REQUEST_TIMEOUT_MS): RequestOutcome {
    if (from === to) return { ok: false, reason: "cannot connect to yourself" };

    const requester = this.presence.get(from);
    const target = this.presence.get(to);
    if (!requester) return { ok: false, reason: "requester is not registered" };
    if (!target) return { ok: false, reason: `${to} is not online` };
    if (requester.networkId !== target.networkId) {
      // Discovery is network-scoped; so is pairing. You cannot reach across groups.
      return { ok: false, reason: `${to} is not on your network` };
    }

    // Reciprocal race: they asked for us while we were asking for them.
    const theirs = this.pendingFor(to);
    if (theirs && theirs.from === to && theirs.to === from) {
      const session = this.pair(theirs.from, theirs.to);
      if (!session) return { ok: false, reason: "could not open session" };
      const consumed = [theirs.requestId, requestId];
      this.clear(theirs.requestId);
      this.log.log(`reciprocal request ${from} <-> ${to} — auto-accepted`);
      return { ok: true, kind: "auto-accepted", session, requestIds: consumed };
    }

    if (this.registry.sessionOf(from)) return { ok: false, reason: "you are already in a session" };
    if (requester.state !== "available") return { ok: false, reason: `you are ${requester.state}` };
    if (target.state !== "available") return { ok: false, reason: `${to} is ${target.state}` };

    const pending: PendingRequest = {
      requestId,
      from,
      fromDisplayName: requester.displayName,
      to,
      createdAt: Date.now(),
    };
    this.requests.set(requestId, pending);
    this.requestByUser.set(from, requestId);
    this.requestByUser.set(to, requestId);
    // Soft-lock both ends so no third party can grab either mid-handshake.
    this.presence.setState(from, "pending");
    this.presence.setState(to, "pending");

    pending.timer = setTimeout(() => this.expire(requestId), timeoutMs);
    (pending.timer as { unref?: () => void }).unref?.();
    return { ok: true, kind: "sent", request: pending };
  }

  // -- response -------------------------------------------------------------

  respond(requestId: string, decision: "approve" | "reject", responder: HumanId): RespondOutcome {
    const request = this.requests.get(requestId);
    if (!request) return { ok: false, reason: "no such connect request (it may have timed out)" };
    if (request.to !== responder) return { ok: false, reason: "only the invited user can answer this request" };

    this.clear(requestId);

    if (decision === "reject") {
      this.presence.setState(request.from, "available");
      this.presence.setState(request.to, "available");
      return { ok: true, decision: "reject", request };
    }

    const session = this.pair(request.from, request.to);
    if (!session) return { ok: false, reason: "could not open session" };
    return { ok: true, decision: "approve", session, request };
  }

  // -- teardown -------------------------------------------------------------

  /** End a session and return both participants to `available`. */
  end(sessionId: string, reason: EndedSession["reason"]): EndedSession | undefined {
    const session = this.registry.close(sessionId);
    if (!session) return undefined;
    for (const userId of session.participants) {
      if (this.presence.stateOf(userId) !== "offline") this.presence.setState(userId, "available");
    }
    this.log.log(`session ${sessionId} ended (${reason})`);
    return { session, reason };
  }

  /** A user dropped (disconnect or missed beats): cancel their handshake and tear
   *  down their session, freeing the partner. */
  handleDrop(userId: HumanId): { cancelled?: PendingRequest; ended?: EndedSession } {
    const result: { cancelled?: PendingRequest; ended?: EndedSession } = {};

    const pending = this.pendingFor(userId);
    if (pending) {
      this.clear(pending.requestId);
      const other = pending.from === userId ? pending.to : pending.from;
      if (this.presence.stateOf(other) !== "offline") this.presence.setState(other, "available");
      result.cancelled = pending;
    }

    const session = this.registry.sessionOf(userId);
    if (session) result.ended = this.end(session.sessionId, "partner_dropped");
    return result;
  }

  /** Cancel every timer — the module is going down. */
  shutdown(): void {
    for (const request of this.requests.values()) if (request.timer) clearTimeout(request.timer);
    this.requests.clear();
    this.requestByUser.clear();
  }

  // -- internals ------------------------------------------------------------

  private pair(a: HumanId, b: HumanId): Session | undefined {
    const recordA = this.presence.get(a);
    const recordB = this.presence.get(b);
    if (!recordA || !recordB) return undefined;
    const session = this.registry.open(a, b, recordA.networkId);
    this.presence.setState(a, "reserved", b);
    this.presence.setState(b, "reserved", a);
    this.log.log(`session ${session.sessionId}: ${a} <-> ${b}`);
    return session;
  }

  private clear(requestId: string): PendingRequest | undefined {
    const request = this.requests.get(requestId);
    if (!request) return undefined;
    if (request.timer) clearTimeout(request.timer);
    this.requests.delete(requestId);
    if (this.requestByUser.get(request.from) === requestId) this.requestByUser.delete(request.from);
    if (this.requestByUser.get(request.to) === requestId) this.requestByUser.delete(request.to);
    return request;
  }

  /** Timeout path: auto-reject, both back to `available`. */
  expire(requestId: string): void {
    const request = this.clear(requestId);
    if (!request) return;
    for (const userId of [request.from, request.to]) {
      if (this.presence.stateOf(userId) === "pending") this.presence.setState(userId, "available");
    }
    this.log.log(`connect request ${requestId} (${request.from} -> ${request.to}) timed out`);
    for (const handler of this.timeoutHandlers) handler(request);
  }
}

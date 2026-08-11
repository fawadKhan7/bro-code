/** The handshake engine — the "approve" right.
 *
 *  A cross-agent `request` is a *proposal*. It lands in the receiving agent's approval
 *  inbox and does nothing at all until that agent's owner accepts it. Only then does
 *  the coordinator turn it into a real command in their queue. There is no path from
 *  one agent to the other agent's queue that skips this.
 */
import { Injectable, Logger } from "@nestjs/common";
import type { ApprovalPayload, CommandPayload, HumanId, PendingApproval, RequestPayload } from "@duo/coord-client";
import { SessionRegistry } from "../session/session.registry.js";
import type { AgentRef } from "../session/session.types.js";

export type ResolveOutcome =
  | { ok: false; reason: string }
  | { ok: true; decision: "accept"; approval: PendingApproval; command: CommandPayload }
  | { ok: true; decision: "reject" | "renegotiate"; approval: PendingApproval; payload: ApprovalPayload };

@Injectable()
export class HandshakeService {
  private readonly log = new Logger("Handshake");
  /** sessionId -> requestId -> proposal. */
  private readonly inboxes = new Map<string, Map<string, PendingApproval>>();

  constructor(private readonly registry: SessionRegistry) {}

  receive(
    sessionId: string,
    from: AgentRef,
    to: AgentRef,
    payload: RequestPayload,
  ): { ok: false; reason: string } | { ok: true; approval: PendingApproval } {
    if (from === to) return { ok: false, reason: "a request must cross to the other agent" };
    const inbox = this.inboxFor(sessionId);
    if (inbox.has(payload.requestId)) return { ok: false, reason: `request ${payload.requestId} already pending` };

    const approval: PendingApproval = {
      requestId: payload.requestId,
      from,
      to,
      summary: payload.summary,
      blocking: payload.blocking,
      ...(payload.proposedContract ? { proposedContract: payload.proposedContract } : {}),
      receivedAt: new Date().toISOString(),
    };
    inbox.set(payload.requestId, approval);
    this.log.log(`proposal ${payload.requestId}: ${from} -> ${to} — ${payload.summary.slice(0, 60)}`);
    return { ok: true, approval };
  }

  /** Only the human who owns the receiving agent may answer. Since an agent is
   *  addressed by its owner, that is simply `approval.to`. */
  resolve(sessionId: string, payload: ApprovalPayload, responder: HumanId): ResolveOutcome {
    const inbox = this.inboxFor(sessionId);
    const approval = inbox.get(payload.requestId);
    if (!approval) return { ok: false, reason: `no pending request ${payload.requestId}` };

    const session = this.registry.get(sessionId);
    if (!session?.participants.includes(approval.to)) {
      return { ok: false, reason: "the receiving agent is not in this session" };
    }
    if (approval.to !== responder) {
      return { ok: false, reason: `only ${approval.to} can approve a request aimed at their own agent` };
    }

    inbox.delete(payload.requestId);

    if (payload.decision !== "accept") {
      return { ok: true, decision: payload.decision, approval, payload };
    }

    const counter = payload.counterProposal;
    const contract = counter?.proposedContract ?? approval.proposedContract;
    const command: CommandPayload = {
      intent: counter?.summary ?? approval.summary,
      // The request schema carries no file list, so the contract is the scope: two
      // commands touching the same endpoint must not run at once.
      scope: contract ? [`contract:${contract.method} ${contract.endpoint}`] : [],
      // A blocking request has the peer agent waiting on it — jump the normal work.
      priority: (counter?.blocking ?? approval.blocking) ? "urgent" : "normal",
    };
    return { ok: true, decision: "accept", approval, command };
  }

  pending(sessionId: string): PendingApproval[] {
    return [...this.inboxFor(sessionId).values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  disposeSession(sessionId: string): void {
    this.inboxes.delete(sessionId);
  }

  private inboxFor(sessionId: string): Map<string, PendingApproval> {
    let inbox = this.inboxes.get(sessionId);
    if (!inbox) {
      inbox = new Map();
      this.inboxes.set(sessionId, inbox);
    }
    return inbox;
  }
}

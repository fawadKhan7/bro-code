import type { ActivityEntry, AgentRef, HumanId } from "@duo/coord-client";

export type { AgentRef };

/** An established 1:1 BroCode session. Everything development-related is scoped to one.
 *
 *  Agents have no role and no assigned territory: each participant brings exactly one
 *  agent, addressed by their own id. What stops the two from colliding is the lock
 *  manager, at the moment work actually starts — not a label handed out in advance. */
export interface Session {
  sessionId: string;
  participants: [HumanId, HumanId];
  networkId: string;
  startedAt: string;
  /** Bounded ring buffer; the dashboard only ever renders the tail. */
  activity: ActivityEntry[];
}

/** One connected socket. A human and their agent share a userId, and are told apart
 *  by `role` — the only distinction any connection carries. */
export interface Connection {
  socketId: string;
  userId: HumanId;
  displayName: string;
  role: "human" | "agent";
  networkId: string;
}

export function isParticipant(session: Session, userId: string): boolean {
  return session.participants.includes(userId);
}

/** The other participant in a session, i.e. whose agent a request would cross to. */
export function peerOf(session: Session, userId: HumanId): HumanId | undefined {
  return session.participants.find((participant) => participant !== userId);
}

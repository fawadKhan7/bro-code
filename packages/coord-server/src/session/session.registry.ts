/** Sessions and connected sockets. Pure state — no rules, no socket I/O. */
import { Injectable } from "@nestjs/common";
import { newId, type ActivityPayload, type ActivityEntry, type AgentRef, type HumanId } from "@duo/coord-client";
import type { Connection, Session } from "./session.types.js";

const ACTIVITY_BUFFER = 200;

@Injectable()
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  /** userId -> sessionId. A user is in at most one session, ever. */
  private readonly sessionByUser = new Map<HumanId, string>();
  private readonly connections = new Map<string, Connection>();

  // -- connections ----------------------------------------------------------

  addConnection(connection: Connection): void {
    this.connections.set(connection.socketId, connection);
  }

  removeConnection(socketId: string): Connection | undefined {
    const connection = this.connections.get(socketId);
    this.connections.delete(socketId);
    return connection;
  }

  connection(socketId: string): Connection | undefined {
    return this.connections.get(socketId);
  }

  connectionsOf(userId: HumanId): Connection[] {
    return [...this.connections.values()].filter((c) => c.userId === userId);
  }

  connectionsIn(networkId: string): Connection[] {
    return [...this.connections.values()].filter((c) => c.networkId === networkId);
  }

  /** Does this user still have any socket attached? Their human tab can close while
   *  the agent process stays up, and vice versa. */
  hasRole(userId: HumanId, role: "human" | "agent"): boolean {
    return this.connectionsOf(userId).some((c) => c.role === role);
  }

  // -- sessions -------------------------------------------------------------

  open(a: HumanId, b: HumanId, networkId: string): Session {
    const session: Session = {
      sessionId: newId(),
      participants: [a, b],
      networkId,
      startedAt: new Date().toISOString(),
      activity: [],
    };
    this.sessions.set(session.sessionId, session);
    this.sessionByUser.set(a, session.sessionId);
    this.sessionByUser.set(b, session.sessionId);
    return session;
  }

  close(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    this.sessions.delete(sessionId);
    for (const user of session.participants) this.sessionByUser.delete(user);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  sessionOf(userId: HumanId): Session | undefined {
    const sessionId = this.sessionByUser.get(userId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  all(): Session[] {
    return [...this.sessions.values()];
  }

  /** The partner of `userId` in their session, if any. */
  partnerOf(userId: HumanId): HumanId | undefined {
    const session = this.sessionOf(userId);
    if (!session) return undefined;
    return session.participants.find((p) => p !== userId);
  }

  // -- activity log ---------------------------------------------------------

  appendActivity(sessionId: string, agent: AgentRef, payload: ActivityPayload): ActivityEntry | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const entry: ActivityEntry = { id: newId(), agent, at: new Date().toISOString(), payload };
    session.activity.push(entry);
    if (session.activity.length > ACTIVITY_BUFFER) session.activity.splice(0, session.activity.length - ACTIVITY_BUFFER);
    return entry;
  }
}

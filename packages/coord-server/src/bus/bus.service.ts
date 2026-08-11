/** The message bus: the only thing in the server that touches sockets.
 *
 *  Routing is always scoped — to a user, to a network group, or to a session.
 *  There is deliberately no "emit to everyone" method: `to: 'broadcast'` means the
 *  sender's network group before pairing, and the session participants after.
 */
import { Injectable, Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import {
  ROSTER_EVENT,
  SNAPSHOT_EVENT,
  WIRE_EVENT,
  makeEnvelope,
  type AckPayload,
  type Address,
  type Envelope,
  type EnvelopeType,
  type HumanId,
  type PayloadByType,
  type RosterEntry,
  type SessionSnapshot,
} from "@duo/coord-client";
import { SessionRegistry } from "../session/session.registry.js";
import type { AgentRef } from "../session/session.types.js";

export const userRoom = (userId: HumanId) => `user:${userId}`;
export const networkRoom = (networkId: string) => `net:${networkId}`;
export const sessionRoom = (sessionId: string) => `sess:${sessionId}`;

@Injectable()
export class BusService {
  private readonly log = new Logger("Bus");
  private server: Server | null = null;

  constructor(private readonly registry: SessionRegistry) {}

  attach(server: Server): void {
    this.server = server;
  }

  // -- room membership ------------------------------------------------------

  joinBaseRooms(socketId: string, userId: HumanId, networkId: string): void {
    const socket = this.server?.sockets.sockets.get(socketId);
    if (!socket) return;
    void socket.join(userRoom(userId));
    void socket.join(networkRoom(networkId));
  }

  /** Every socket of both participants — human tabs and agent processes alike. */
  joinSession(sessionId: string, participants: readonly HumanId[]): void {
    if (!this.server) return;
    for (const userId of participants) {
      for (const connection of this.registry.connectionsOf(userId)) {
        this.server.sockets.sockets.get(connection.socketId)?.join(sessionRoom(sessionId));
      }
    }
  }

  leaveSession(sessionId: string): void {
    void this.server?.in(sessionRoom(sessionId)).socketsLeave(sessionRoom(sessionId));
  }

  // -- addressed sends ------------------------------------------------------

  toUser<K extends EnvelopeType>(userId: HumanId, envelope: Envelope<PayloadByType[K]>): void {
    this.server?.to(userRoom(userId)).emit(WIRE_EVENT, envelope);
  }

  toSocket(socketId: string, envelope: Envelope): void {
    this.server?.to(socketId).emit(WIRE_EVENT, envelope);
  }

  /** Target one half of a user's presence — e.g. dispatch a command to the agent
   *  process without echoing it as an instruction to the human's dashboard. */
  toRole(userId: HumanId, role: "human" | "agent", envelope: Envelope): void {
    for (const connection of this.registry.connectionsOf(userId)) {
      if (connection.role === role) this.toSocket(connection.socketId, envelope);
    }
  }

  toNetwork(networkId: string, envelope: Envelope): void {
    this.server?.to(networkRoom(networkId)).emit(WIRE_EVENT, envelope);
  }

  toSession(sessionId: string, envelope: Envelope): void {
    this.server?.to(sessionRoom(sessionId)).emit(WIRE_EVENT, envelope);
  }

  /** Dispatch to a participant's agent process. An agent is addressed by its owner,
   *  so this is simply "the agent-role sockets of that user". */
  toAgent(sessionId: string, agent: AgentRef, envelope: Envelope): boolean {
    const session = this.registry.get(sessionId);
    if (!session?.participants.includes(agent)) return false;
    const agents = this.registry.connectionsOf(agent).filter((c) => c.role === "agent");
    if (agents.length === 0) {
      this.log.warn(`no agent socket for ${agent} in session ${sessionId}`);
      return false;
    }
    for (const connection of agents) this.toSocket(connection.socketId, envelope);
    return true;
  }

  // -- coordinator-authored messages ---------------------------------------

  envelope<K extends EnvelopeType>(
    type: K,
    to: Address,
    payload: PayloadByType[K],
    sessionId?: string,
  ): Envelope<PayloadByType[K]> {
    return makeEnvelope(type, "coordinator", to, payload, sessionId);
  }

  /** Same, but reusing an existing id. Dispatched commands keep the queue's id so
   *  the agent can report `activity.commandId` against the thing it was handed. */
  envelopeWithId<K extends EnvelopeType>(
    id: string,
    type: K,
    to: Address,
    payload: PayloadByType[K],
    sessionId?: string,
  ): Envelope<PayloadByType[K]> {
    return { ...makeEnvelope(type, "coordinator", to, payload, sessionId), id };
  }

  /** Answer a single socket about a single message it sent. */
  ack(socketId: string, to: Address, ack: AckPayload, sessionId?: string): void {
    this.toSocket(socketId, this.envelope("ack", to, ack, sessionId));
  }

  deny(socketId: string, to: Address, refId: string, reason: string, sessionId?: string): void {
    this.ack(socketId, to, { refId, status: "denied", reason }, sessionId);
  }

  // -- read-model pushes ----------------------------------------------------

  pushRoster(networkId: string, roster: RosterEntry[]): void {
    this.server?.to(networkRoom(networkId)).emit(ROSTER_EVENT, roster);
  }

  pushSnapshot(sessionId: string, snapshot: SessionSnapshot | null): void {
    this.server?.to(sessionRoom(sessionId)).emit(SNAPSHOT_EVENT, snapshot);
  }

  pushSnapshotToUser(userId: HumanId, snapshot: SessionSnapshot | null): void {
    this.server?.to(userRoom(userId)).emit(SNAPSHOT_EVENT, snapshot);
  }

  pushRosterToSocket(socketId: string, roster: RosterEntry[]): void {
    this.server?.to(socketId).emit(ROSTER_EVENT, roster);
  }
}

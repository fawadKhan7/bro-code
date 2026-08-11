/** The coordination service: every behavioral rule in one place.
 *
 *  The gateway does sockets and validation; this decides. The three rights are
 *  enforced here and nowhere else:
 *
 *    observe  — every `activity`, `lock`, `contract` and queue change fans out to
 *               both participants. No filtering, ever.
 *    command  — a `command` is accepted only from a human, only for that human's
 *               own agent, and only into the queue. Never executed inline.
 *    approve  — a cross-agent `request` becomes a command only after the owner of the
 *               receiving agent accepts it.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  DEFAULT_LEASE_MS,
  type ActivityPayload,
  type ApprovalPayload,
  type CommandPayload,
  type ConnectRequestPayload,
  type ConnectResponsePayload,
  type ContractPayload,
  type Envelope,
  type HumanId,
  type LockPayload,
  type QueuedCommand,
  type RequestPayload,
  type SessionEndedPayload,
  type SessionSnapshot,
} from "@duo/coord-client";
import { BusService } from "./bus/bus.service.js";
import { ContractService } from "./contract/contract.service.js";
import { HandshakeService } from "./handshake/handshake.service.js";
import { LockService } from "./lock/lock.service.js";
import { PairingService, type EndedSession } from "./pairing/pairing.service.js";
import { PresenceService } from "./presence/presence.service.js";
import { QueueService, type QueueEvent } from "./queue/queue.service.js";
import { SessionRegistry } from "./session/session.registry.js";
import { peerOf, type AgentRef, type Connection, type Session } from "./session/session.types.js";

const SWEEP_INTERVAL_MS = 2_000;

@Injectable()
export class CoordinationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Coordination");
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly bus: BusService,
    private readonly presence: PresenceService,
    private readonly pairing: PairingService,
    private readonly queue: QueueService,
    private readonly locks: LockService,
    private readonly handshake: HandshakeService,
    private readonly contracts: ContractService,
    private readonly registry: SessionRegistry,
  ) {}

  onModuleInit(): void {
    // A running command reaches the agent process as a plain `command` envelope.
    this.queue.onDispatch((sessionId, agent, command) => {
      const delivered = this.bus.toAgent(
        sessionId,
        agent,
        // The envelope carries the queue's id, so the agent reports activity against
        // the same id the queue and both dashboards know it by.
        this.bus.envelopeWithId<"command">(
          command.id,
          "command",
          agent,
          { intent: command.intent, scope: command.scope, priority: command.priority },
          sessionId,
        ),
      );
      if (!delivered) {
        // No agent process attached. The command stays `running` and the locks stay
        // held until the agent connects and reports, or the lease expires.
        this.emitActivity(sessionId, agent, {
          status: "progress",
          task: command.intent,
          currentAction: "waiting for the agent process to attach",
          filesTouched: [],
          commandId: command.id,
        });
      }
    });

    // If it isn't on the bus, it didn't happen.
    this.queue.onEvent((event) => this.announceQueueEvent(event));

    this.pairing.onTimeout((request) => {
      for (const userId of [request.from, request.to]) {
        this.bus.toUser(
          userId,
          this.bus.envelope<"session-ended">("session-ended", userId, { sessionId: request.requestId, reason: "timeout" }),
        );
        this.announcePresence(userId);
      }
    });

    this.presence.onOffline((userId) => this.handleDrop(userId, "heartbeat loss"));

    this.sweeper = setInterval(() => {
      this.presence.sweep();
      this.locks.sweep();
      for (const session of this.registry.all()) this.pushSnapshot(session.sessionId);
    }, SWEEP_INTERVAL_MS);
    (this.sweeper as { unref?: () => void }).unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.pairing.shutdown();
  }

  // -- socket lifecycle -----------------------------------------------------

  handleConnect(connection: Connection): void {
    this.registry.addConnection(connection);
    this.presence.register(connection);
    this.bus.joinBaseRooms(connection.socketId, connection.userId, connection.networkId);

    // A reconnecting participant rejoins its session room and gets the current state.
    const session = this.registry.sessionOf(connection.userId);
    if (session) {
      this.bus.joinSession(session.sessionId, session.participants);
      this.bus.toSocket(
        connection.socketId,
        this.bus.envelope<"session-established">(
          "session-established",
          connection.userId,
          {
            sessionId: session.sessionId,
            participants: session.participants,
          },
          session.sessionId,
        ),
      );
    }

    this.log.log(`${connection.role} ${connection.userId} joined ${connection.networkId}`);
    this.announcePresence(connection.userId);
    this.bus.pushRosterToSocket(connection.socketId, this.presence.roster(connection.networkId));
    if (session) this.pushSnapshot(session.sessionId);
  }

  handleDisconnect(socketId: string): void {
    const connection = this.registry.removeConnection(socketId);
    if (!connection) return;

    // The human tab can close while the agent process stays up, and vice versa.
    // Only a user with nothing left attached is really gone.
    if (this.registry.connectionsOf(connection.userId).length > 0) {
      this.announcePresence(connection.userId);
      return;
    }

    this.handleDrop(connection.userId, "disconnect");
    this.presence.forget(connection.userId);
    this.bus.pushRoster(connection.networkId, this.presence.roster(connection.networkId));
  }

  private handleDrop(userId: HumanId, cause: string): void {
    const { cancelled, ended } = this.pairing.handleDrop(userId);
    if (cancelled) {
      const other = cancelled.from === userId ? cancelled.to : cancelled.from;
      this.bus.toUser(
        other,
        this.bus.envelope<"session-ended">("session-ended", other, { sessionId: cancelled.requestId, reason: "partner_dropped" }),
      );
      this.announcePresence(other);
    }
    if (ended) {
      this.log.warn(`tearing down ${ended.session.sessionId} — ${userId} dropped (${cause})`);
      this.closeSession(ended);
    }
    this.announcePresence(userId);
  }

  // -- inbound envelopes ----------------------------------------------------

  /** `envelope` has already been schema-validated by the gateway. */
  handleEnvelope(connection: Connection, envelope: Envelope): void {
    // Identity is established at connect time; a socket cannot speak as anyone else.
    if (envelope.from !== connection.userId) {
      return this.deny(connection, envelope, `cannot send as '${envelope.from}'`);
    }

    const session = this.registry.sessionOf(connection.userId);
    if (envelope.sessionId && envelope.sessionId !== session?.sessionId) {
      return this.deny(connection, envelope, "sessionId does not match your active session");
    }

    switch (envelope.type) {
      case "heartbeat":
        return this.presence.beat(connection.userId);
      case "connect-request":
        return this.onConnectRequest(connection, envelope as Envelope<ConnectRequestPayload>);
      case "connect-response":
        return this.onConnectResponse(connection, envelope as Envelope<ConnectResponsePayload>);
      case "session-ended":
        return this.onSessionEnd(connection, envelope as Envelope<SessionEndedPayload>, session);
      case "command":
        return this.onCommand(connection, envelope as Envelope<CommandPayload>, session);
      case "request":
        return this.onRequest(connection, envelope as Envelope<RequestPayload>, session);
      case "approval":
        return this.onApproval(connection, envelope as Envelope<ApprovalPayload>, session);
      case "activity":
        return this.onActivity(connection, envelope as Envelope<ActivityPayload>, session);
      case "lock":
        return this.onLock(connection, envelope as Envelope<LockPayload>, session);
      case "contract":
        return this.onContract(connection, envelope as Envelope<ContractPayload>, session);
      case "presence":
        // Presence is server-owned. Clients observe it; they don't assert it.
        return this.deny(connection, envelope, "presence is set by the coordinator");
      case "session-established":
      case "ack":
        return this.deny(connection, envelope, `'${envelope.type}' is coordinator-authored`);
    }
  }

  // -- pairing --------------------------------------------------------------

  private onConnectRequest(connection: Connection, envelope: Envelope<ConnectRequestPayload>): void {
    if (connection.role !== "human") return this.deny(connection, envelope, "only a human can request a connection");

    const outcome = this.pairing.request(connection.userId, envelope.to, envelope.payload.requestId);
    if (!outcome.ok) return this.deny(connection, envelope, outcome.reason);

    if (outcome.kind === "auto-accepted") {
      this.bus.ack(connection.socketId, connection.userId, { refId: envelope.id, status: "received" });
      return this.openSession(outcome.session);
    }

    // The invitee's dashboard shows the prompt; both ends are now soft-locked.
    this.bus.toRole(
      envelope.to,
      "human",
      this.bus.envelope<"connect-request">("connect-request", envelope.to, {
        requestId: outcome.request.requestId,
        fromUser: outcome.request.from,
        fromDisplayName: outcome.request.fromDisplayName,
      }),
    );
    this.bus.ack(connection.socketId, connection.userId, { refId: envelope.id, status: "received" });
    this.announcePresence(connection.userId);
    this.announcePresence(envelope.to);
  }

  private onConnectResponse(connection: Connection, envelope: Envelope<ConnectResponsePayload>): void {
    if (connection.role !== "human") return this.deny(connection, envelope, "only a human can answer a connection request");

    const outcome = this.pairing.respond(envelope.payload.requestId, envelope.payload.decision, connection.userId);
    if (!outcome.ok) return this.deny(connection, envelope, outcome.reason);

    this.bus.ack(connection.socketId, connection.userId, { refId: envelope.id, status: "received" });

    if (outcome.decision === "reject") {
      this.bus.toUser(
        outcome.request.from,
        this.bus.envelope<"session-ended">("session-ended", outcome.request.from, {
          sessionId: outcome.request.requestId,
          reason: "rejected",
        }),
      );
      this.announcePresence(outcome.request.from);
      this.announcePresence(outcome.request.to);
      return;
    }

    this.openSession(outcome.session);
  }

  private onSessionEnd(connection: Connection, envelope: Envelope<SessionEndedPayload>, session: Session | undefined): void {
    if (!session) return this.deny(connection, envelope, "you are not in a session");
    if (connection.role !== "human") return this.deny(connection, envelope, "only a human can end the session");

    const ended = this.pairing.end(session.sessionId, "ended");
    this.bus.ack(connection.socketId, connection.userId, { refId: envelope.id, status: "received" });
    if (ended) this.closeSession(ended);
  }

  private openSession(session: Session): void {
    this.bus.joinSession(session.sessionId, session.participants);
    const payload = { sessionId: session.sessionId, participants: session.participants };
    this.bus.toSession(
      session.sessionId,
      this.bus.envelope<"session-established">("session-established", "broadcast", payload, session.sessionId),
    );
    for (const userId of session.participants) this.announcePresence(userId);
    this.pushSnapshot(session.sessionId);
  }

  private closeSession(ended: EndedSession): void {
    const { session, reason } = ended;
    this.bus.toSession(
      session.sessionId,
      this.bus.envelope<"session-ended">("session-ended", "broadcast", { sessionId: session.sessionId, reason }, session.sessionId),
    );
    this.bus.pushSnapshot(session.sessionId, null);
    this.bus.leaveSession(session.sessionId);

    // Queues, locks, inboxes and contracts are session-scoped — nothing survives.
    this.queue.disposeSession(session.sessionId);
    this.locks.releaseAllInSession(session.sessionId);
    this.handshake.disposeSession(session.sessionId);
    this.contracts.disposeSession(session.sessionId);

    for (const userId of session.participants) this.announcePresence(userId);
  }

  // -- development coordination --------------------------------------------

  private onCommand(connection: Connection, envelope: Envelope<CommandPayload>, session: Session | undefined): void {
    if (!session) return this.deny(connection, envelope, "commands require an established session");
    if (connection.role !== "human") return this.deny(connection, envelope, "only a human issues commands");
    if (!session.participants.includes(envelope.to)) {
      return this.deny(connection, envelope, `'${envelope.to}' has no agent in this session`);
    }

    // The command right is ownership-scoped. Reaching into the partner's agent is the
    // whole thing this layer exists to prevent — use a cross-agent request.
    if (envelope.to !== connection.userId) {
      return this.deny(
        connection,
        envelope,
        `you command your own agent, not '${envelope.to}' — send a cross-agent request instead`,
      );
    }

    const position = this.queue.enqueue(session.sessionId, envelope.to, {
      id: envelope.id,
      issuedBy: connection.userId,
      payload: envelope.payload,
    });
    this.bus.ack(
      connection.socketId,
      connection.userId,
      { refId: envelope.id, status: "queued", queuePosition: position },
      session.sessionId,
    );
  }

  private onRequest(connection: Connection, envelope: Envelope<RequestPayload>, session: Session | undefined): void {
    if (!session) return this.deny(connection, envelope, "requests require an established session");
    if (connection.role !== "agent") return this.deny(connection, envelope, "cross-agent requests come from an agent");
    const peer = peerOf(session, connection.userId);
    if (!peer || envelope.to !== peer) {
      return this.deny(connection, envelope, `a request must be addressed to your peer's agent ('${peer ?? "none"}')`);
    }

    const outcome = this.handshake.receive(session.sessionId, connection.userId, envelope.to, envelope.payload);
    if (!outcome.ok) return this.deny(connection, envelope, outcome.reason);

    // Proposed, not executed. It sits in the inbox until the owner accepts.
    this.bus.ack(connection.socketId, connection.userId, { refId: envelope.id, status: "received" }, session.sessionId);
    this.bus.toSession(
      session.sessionId,
      this.bus.envelope<"request">("request", envelope.to, envelope.payload, session.sessionId),
    );
    this.emitActivity(session.sessionId, connection.userId, {
      status: "progress",
      task: envelope.payload.summary,
      currentAction: `awaiting ${envelope.to} approval${envelope.payload.blocking ? " (blocking)" : ""}`,
      filesTouched: [],
    });
    this.pushSnapshot(session.sessionId);
  }

  private onApproval(connection: Connection, envelope: Envelope<ApprovalPayload>, session: Session | undefined): void {
    if (!session) return this.deny(connection, envelope, "approvals require an established session");
    if (connection.role !== "human") return this.deny(connection, envelope, "only the receiving agent's owner approves");

    const outcome = this.handshake.resolve(session.sessionId, envelope.payload, connection.userId);
    if (!outcome.ok) return this.deny(connection, envelope, outcome.reason);

    this.bus.ack(connection.socketId, connection.userId, { refId: envelope.id, status: "received" }, session.sessionId);
    this.bus.toSession(
      session.sessionId,
      this.bus.envelope<"approval">("approval", outcome.approval.from, envelope.payload, session.sessionId),
    );

    if (outcome.decision === "accept") {
      // Only now does a proposal become real work — in the receiving agent's queue.
      this.queue.enqueue(session.sessionId, outcome.approval.to, {
        id: envelope.id,
        issuedBy: connection.userId,
        payload: outcome.command,
        originRequestId: outcome.approval.requestId,
      });
    } else {
      this.emitActivity(session.sessionId, outcome.approval.to, {
        status: "idle",
        task: outcome.approval.summary,
        currentAction: `${outcome.decision === "reject" ? "rejected" : "renegotiating"}${
          envelope.payload.reason ? `: ${envelope.payload.reason}` : ""
        }`,
        filesTouched: [],
      });
    }
    this.pushSnapshot(session.sessionId);
  }

  private onActivity(connection: Connection, envelope: Envelope<ActivityPayload>, session: Session | undefined): void {
    if (!session) return; // Nothing development-related flows before pairing.
    if (connection.role !== "agent") return this.deny(connection, envelope, "activity is reported by agents");

    const payload = envelope.payload;
    this.registry.appendActivity(session.sessionId, connection.userId, payload);
    this.bus.toSession(
      session.sessionId,
      this.bus.envelope<"activity">("activity", "broadcast", payload, session.sessionId),
    );

    // Terminal states close the command out and free its whole scope.
    if ((payload.status === "completed" || payload.status === "failed") && payload.commandId) {
      const running = this.queue.running(session.sessionId, connection.userId);
      if (running && running.id === payload.commandId) {
        this.queue.finish(session.sessionId, connection.userId, payload.commandId, payload.status === "completed" ? "done" : "failed");
      }
    }
    this.pushSnapshot(session.sessionId);
  }

  private onLock(connection: Connection, envelope: Envelope<LockPayload>, session: Session | undefined): void {
    if (!session) return this.deny(connection, envelope, "locks require an established session");
    if (connection.role !== "agent") return this.deny(connection, envelope, "only agents lease resources");

    const { action, resource, leaseMs } = envelope.payload;
    if (action === "release") {
      const released = this.locks.release(session.sessionId, connection.userId, resource);
      this.bus.ack(
        connection.socketId,
        connection.userId,
        released
          ? { refId: envelope.id, status: "granted" }
          : { refId: envelope.id, status: "denied", reason: `you do not hold ${resource}` },
        session.sessionId,
      );
    } else {
      const running = this.queue.running(session.sessionId, connection.userId);
      const result = this.locks.acquire(
        session.sessionId,
        connection.userId,
        resource,
        leaseMs ?? DEFAULT_LEASE_MS,
        running?.id,
      );
      this.bus.ack(
        connection.socketId,
        connection.userId,
        result.granted
          ? { refId: envelope.id, status: "granted" }
          : { refId: envelope.id, status: "denied", reason: `${resource} is held by ${result.heldBy}` },
        session.sessionId,
      );
    }

    // Lock decisions are observable: the other human sees why work is waiting.
    this.bus.toSession(session.sessionId, this.bus.envelope<"lock">("lock", "broadcast", envelope.payload, session.sessionId));
    this.pushSnapshot(session.sessionId);
  }

  private onContract(connection: Connection, envelope: Envelope<ContractPayload>, session: Session | undefined): void {
    if (!session) return this.deny(connection, envelope, "contracts require an established session");
    if (connection.role !== "agent") return this.deny(connection, envelope, "contracts are published by agents");

    this.contracts.publish(session.sessionId, envelope.payload, connection.userId);
    this.bus.ack(connection.socketId, connection.userId, { refId: envelope.id, status: "received" }, session.sessionId);
    // The peer agent consumes this; both dashboards render it.
    this.bus.toSession(
      session.sessionId,
      this.bus.envelope<"contract">("contract", "broadcast", envelope.payload, session.sessionId),
    );
    this.emitActivity(session.sessionId, connection.userId, {
      status: "progress",
      task: `contract ${envelope.payload.method} ${envelope.payload.endpoint} v${envelope.payload.version}`,
      currentAction: envelope.payload.breaking ? "published a BREAKING contract change" : "published a contract update",
      filesTouched: [],
    });
    this.pushSnapshot(session.sessionId);
  }

  // -- broadcasting ---------------------------------------------------------

  /** Queue transitions are the thing a second commander needs to see before piling on. */
  private announceQueueEvent(event: QueueEvent): void {
    const { sessionId, agent, command } = event;
    switch (event.kind) {
      case "enqueued":
        this.emitActivity(sessionId, agent, {
          status: event.position > 1 ? "progress" : "idle",
          task: command.intent,
          currentAction:
            event.position > 1
              ? `queued at position ${event.position} — a task is already running`
              : "queued, starting next",
          filesTouched: command.scope,
          commandId: command.id,
        });
        break;
      case "started":
        this.emitActivity(sessionId, agent, {
          status: "started",
          task: command.intent,
          currentAction: `holding ${command.scope.length} lock(s)`,
          filesTouched: command.scope,
          commandId: command.id,
        });
        break;
      case "blocked":
        this.emitActivity(sessionId, agent, {
          status: "progress",
          task: command.intent,
          currentAction: `waiting on lock(s): ${event.blockedOn.join(", ")}`,
          filesTouched: command.scope,
          commandId: command.id,
        });
        break;
      case "finished":
        this.emitActivity(sessionId, agent, {
          status: command.status === "done" ? "completed" : "failed",
          task: command.intent,
          currentAction: "locks released",
          filesTouched: command.scope,
          commandId: command.id,
        });
        break;
    }
    this.pushSnapshot(sessionId);
  }

  /** Coordinator-authored activity, attributed to the agent it describes. */
  private emitActivity(sessionId: string, agent: AgentRef, payload: ActivityPayload): void {
    this.registry.appendActivity(sessionId, agent, payload);
    this.bus.toSession(sessionId, this.bus.envelope<"activity">("activity", "broadcast", payload, sessionId));
  }

  private announcePresence(userId: HumanId): void {
    const record = this.presence.get(userId);
    if (!record) return;
    this.bus.toNetwork(
      record.networkId,
      this.bus.envelope<"presence">("presence", "broadcast", {
        userId: record.userId,
        displayName: record.displayName,
        state: record.state,
        networkId: record.networkId,
        ...(record.partnerId ? { partnerId: record.partnerId } : {}),
      }),
    );
    this.bus.pushRoster(record.networkId, this.presence.roster(record.networkId));
  }

  private deny(connection: Connection, envelope: Envelope, reason: string): void {
    this.log.warn(`denied ${envelope.type} from ${connection.userId}: ${reason}`);
    this.bus.deny(connection.socketId, envelope.from, envelope.id, reason, envelope.sessionId);
  }

  // -- read models ----------------------------------------------------------

  buildSnapshot(sessionId: string): SessionSnapshot | null {
    const session = this.registry.get(sessionId);
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      participants: session.participants,
      startedAt: session.startedAt,
      queues: this.queue.list(sessionId) as Record<string, QueuedCommand[]>,
      locks: this.locks.held(sessionId),
      approvals: this.handshake.pending(sessionId),
      contracts: this.contracts.list(sessionId),
      activity: session.activity,
    };
  }

  pushSnapshot(sessionId: string): void {
    this.bus.pushSnapshot(sessionId, this.buildSnapshot(sessionId));
  }
}

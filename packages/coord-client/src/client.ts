/** The typed client adapter. Both humans (dashboard) and agents import this;
 *  neither one hand-builds an envelope or touches socket.io directly.
 *
 *  Runs in node (agent processes) and the browser (dashboard) unchanged.
 */
import { io, type Socket } from "socket.io-client";
import {
  DEFAULT_LEASE_MS,
  HEARTBEAT_INTERVAL_MS,
  ROSTER_EVENT,
  SNAPSHOT_EVENT,
  WIRE_EVENT,
  makeEnvelope,
  newId,
  type AckPayload,
  type ActivityPayload,
  type Address,
  type AgentRef,
  type ApprovalPayload,
  type CommandPayload,
  type ContractPayload,
  type Envelope,
  type EnvelopeType,
  type HandshakeAuth,
  type HumanId,
  type PayloadByType,
  type RosterEntry,
  type SessionEstablishedPayload,
  type SessionSnapshot,
} from "./protocol.js";

/** Everything a consumer can subscribe to: one event per envelope type, plus
 *  the two server snapshots and the socket lifecycle. */
export interface CoordClientEvents extends PayloadByTypeAsEvents {
  roster: RosterEntry[];
  snapshot: SessionSnapshot | null;
  connected: void;
  disconnected: string;
  /** Protocol-level rejection (a `denied` ack, or a malformed envelope). */
  error: { message: string; refId?: string };
}

type PayloadByTypeAsEvents = {
  [K in EnvelopeType]: { payload: PayloadByType[K]; envelope: Envelope<PayloadByType[K]> };
};

export interface CoordClientOptions {
  /** e.g. "http://192.168.1.24:4141" — the machine running the coordination server. */
  url: string;
  auth: HandshakeAuth;
  heartbeatIntervalMs?: number;
  /** How long to wait for the coordinator's ack before rejecting. */
  ackTimeoutMs?: number;
}

type Handler<T> = (value: T) => void;

export class CoordClient {
  private socket: Socket | null = null;
  private handlers = new Map<string, Set<Handler<never>>>();
  private pendingAcks = new Map<string, { resolve: (a: AckPayload) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private _roster: RosterEntry[] = [];
  private _snapshot: SessionSnapshot | null = null;
  private _session: SessionEstablishedPayload | null = null;

  constructor(private readonly options: CoordClientOptions) {}

  // -- lifecycle ------------------------------------------------------------

  get userId(): HumanId {
    return this.options.auth.userId;
  }

  /** This connection's own agent — same id as its owner. Commands may only target it. */
  get agent(): AgentRef {
    return this.options.auth.userId;
  }

  /** The other participant's agent, once paired. */
  get peerAgent(): AgentRef | undefined {
    return this._session?.participants.find((participant) => participant !== this.userId);
  }

  get roster(): RosterEntry[] {
    return this._roster;
  }

  get snapshot(): SessionSnapshot | null {
    return this._snapshot;
  }

  get session(): SessionEstablishedPayload | null {
    return this._session;
  }

  get sessionId(): string | undefined {
    return this._session?.sessionId;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  connect(): Promise<void> {
    if (this.socket) return Promise.resolve();
    const socket = io(this.options.url, {
      auth: this.options.auth as unknown as Record<string, unknown>,
      transports: ["websocket"],
      reconnection: true,
    });
    this.socket = socket;

    socket.on(WIRE_EVENT, (raw: Envelope) => this.receive(raw));
    socket.on(ROSTER_EVENT, (roster: RosterEntry[]) => {
      this._roster = roster;
      this.emit("roster", roster);
    });
    socket.on(SNAPSHOT_EVENT, (snapshot: SessionSnapshot | null) => {
      this._snapshot = snapshot;
      this.emit("snapshot", snapshot);
    });
    socket.on("disconnect", (reason: string) => {
      this.stopHeartbeat();
      this.emit("disconnected", reason);
    });

    return new Promise((resolve, reject) => {
      socket.once("connect", () => {
        this.startHeartbeat();
        this.emit("connected", undefined);
        resolve();
      });
      socket.once("connect_error", (err: Error) => {
        this.emit("error", { message: err.message });
        reject(err);
      });
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("client disconnected"));
    }
    this.pendingAcks.clear();
    this.socket?.disconnect();
    this.socket = null;
    this._session = null;
    this._snapshot = null;
  }

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof CoordClientEvents>(event: K, handler: Handler<CoordClientEvents[K]>): () => void {
    let set = this.handlers.get(event as string);
    if (!set) {
      set = new Set();
      this.handlers.set(event as string, set);
    }
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  }

  // -- pairing (human) ------------------------------------------------------

  /** Ask `targetUserId` to pair. Both of you go `pending` until they answer or 30s elapse. */
  requestConnect(targetUserId: HumanId): Promise<AckPayload> {
    return this.send("connect-request", targetUserId, {
      requestId: newId(),
      fromUser: this.userId,
      fromDisplayName: this.options.auth.displayName,
    });
  }

  respondConnect(requestId: string, decision: "approve" | "reject", requesterId: HumanId): Promise<AckPayload> {
    return this.send("connect-response", requesterId, { requestId, decision });
  }

  /** Tear down the active session; both participants return to `available`. */
  endSession(): Promise<AckPayload> {
    const sessionId = this.sessionId;
    if (!sessionId) return Promise.reject(new Error("not in a session"));
    return this.send("session-ended", "coordinator", { sessionId, reason: "ended" });
  }

  // -- development coordination ---------------------------------------------

  /** Human -> own agent. The server enqueues it and acks with the queue position.
   *  Defaults to your own agent, which is the only one you may command — targeting the
   *  partner's is rejected by design, use {@link proposeToPeer}. */
  sendCommand(command: CommandPayload, agent: AgentRef = this.agent): Promise<AckPayload> {
    return this.send("command", agent, command);
  }

  /** Agent -> the other participant's agent. Lands in their approval inbox as a
   *  proposal; it executes only once that agent's owner accepts. */
  proposeToPeer(
    targetAgent: AgentRef,
    request: { summary: string; blocking?: boolean; proposedContract?: ContractPayload; requestId?: string },
  ): Promise<AckPayload> {
    return this.send("request", targetAgent, {
      requestId: request.requestId ?? newId(),
      summary: request.summary,
      blocking: request.blocking ?? false,
      ...(request.proposedContract ? { proposedContract: request.proposedContract } : {}),
    });
  }

  /** Resolve a proposal sitting in your inbox. `accept` converts it into a queued command. */
  resolveRequest(requesterAgent: AgentRef, approval: ApprovalPayload): Promise<AckPayload> {
    return this.send("approval", requesterAgent, approval);
  }

  /** Agent -> everyone. If it isn't on the bus, it didn't happen. */
  reportActivity(activity: ActivityPayload): Promise<AckPayload> {
    return this.send("activity", "broadcast", activity);
  }

  acquireLock(resource: string, leaseMs: number = DEFAULT_LEASE_MS): Promise<AckPayload> {
    return this.send("lock", "coordinator", { action: "acquire", resource, leaseMs });
  }

  releaseLock(resource: string): Promise<AckPayload> {
    return this.send("lock", "coordinator", { action: "release", resource });
  }

  /** Agent -> broadcast. The peer agent consumes this to stay loosely coupled. */
  publishContract(contract: ContractPayload): Promise<AckPayload> {
    return this.send("contract", "broadcast", contract);
  }

  /** Agent-side convenience: run `handler` for each command the coordinator dispatches.
   *  The coordinator only ever has one command in flight per agent, so this is
   *  serialized by construction — but the handler is chained anyway to keep that
   *  true even if a caller reconnects mid-task. */
  onCommand(handler: (command: CommandPayload, envelope: Envelope<CommandPayload>) => void | Promise<void>): () => void {
    let chain: Promise<void> = Promise.resolve();
    return this.on("command", ({ payload, envelope }) => {
      chain = chain.then(() => handler(payload, envelope)).catch((err: unknown) => {
        this.emit("error", { message: err instanceof Error ? err.message : String(err), refId: envelope.id });
      });
    });
  }

  // -- internals ------------------------------------------------------------

  /** Emit an envelope and resolve with the coordinator's ack. */
  send<K extends EnvelopeType>(type: K, to: Address, payload: PayloadByType[K]): Promise<AckPayload> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("client not connected"));

    const envelope = makeEnvelope(type, this.userId, to, payload, this.sessionId);
    socket.emit(WIRE_EVENT, envelope);

    // Acks are fire-and-forget for the streams (activity, heartbeat) — the server
    // does not ack those, so don't leave a promise hanging.
    if (type === "activity" || type === "heartbeat" || type === "ack" || type === "presence") {
      return Promise.resolve({ refId: envelope.id, status: "received" });
    }

    return new Promise<AckPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(envelope.id);
        reject(new Error(`no ack for ${type} within ${this.options.ackTimeoutMs ?? 10_000}ms`));
      }, this.options.ackTimeoutMs ?? 10_000);
      this.pendingAcks.set(envelope.id, { resolve, reject, timer });
    });
  }

  private receive(raw: Envelope): void {
    if (!raw || typeof raw !== "object" || typeof raw.type !== "string") return;

    if (raw.type === "ack") {
      const ack = raw.payload as AckPayload;
      const pending = this.pendingAcks.get(ack.refId);
      if (pending) {
        this.pendingAcks.delete(ack.refId);
        clearTimeout(pending.timer);
        pending.resolve(ack);
      }
      if (ack.status === "denied") this.emit("error", { message: ack.reason ?? "denied", refId: ack.refId });
    }

    if (raw.type === "session-established") {
      this._session = raw.payload as SessionEstablishedPayload;
    } else if (raw.type === "session-ended") {
      this._session = null;
      this._snapshot = null;
    }

    this.emit(raw.type as keyof CoordClientEvents, { payload: raw.payload, envelope: raw } as never);
  }

  private emit<K extends keyof CoordClientEvents>(event: K, value: CoordClientEvents[K]): void {
    const set = this.handlers.get(event as string);
    if (!set) return;
    for (const handler of set) (handler as Handler<CoordClientEvents[K]>)(value);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const every = this.options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    const beat = () => {
      this.socket?.emit(
        WIRE_EVENT,
        makeEnvelope("heartbeat", this.userId, "coordinator", { userId: this.userId, ts: new Date().toISOString() }, this.sessionId),
      );
    };
    beat();
    this.heartbeatTimer = setInterval(beat, every);
    // Don't hold a node process open just to beat.
    (this.heartbeatTimer as { unref?: () => void }).unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

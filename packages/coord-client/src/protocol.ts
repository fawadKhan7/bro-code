/** The BroCode Phase 2 coordination protocol.
 *
 *  Every message on the wire is an {@link Envelope}. `payload` is discriminated by `type`.
 *  This file is the single source of truth shared by the coordination server, the agent/user
 *  client adapter, and the dashboard — nothing re-declares these shapes.
 *
 *  Three distinct rights, deliberately not collapsed into one permission:
 *    observe  — symmetric, every human sees every agent's activity, always, read-only.
 *    command  — ownership-scoped, a human commands only their own agent.
 *    approve  — the owner of the receiving agent gates anything crossing into it.
 *
 *  Agents carry no role. There is exactly one agent per participant, and it is
 *  addressed by its owner's id: `to: 'coffee'` on a `command` means coffee's agent.
 *  Which part of the codebase anyone touches is decided by locks at runtime, not by a
 *  label assigned up front.
 */

/** A human participant, e.g. 'coffee', 'friend'. Also addresses that human's agent. */
export type HumanId = string;
/** Routing addresses that are never owners of work. */
export type ReservedAddress = "coordinator" | "broadcast";
/** Anything an envelope can be addressed to. */
export type Address = HumanId | ReservedAddress;
/** An agent, addressed by its owner. Distinct name, same value — it documents intent
 *  at the call site when a field means "whose agent" rather than "which human". */
export type AgentRef = HumanId;

export type PresenceState = "available" | "pending" | "reserved" | "offline";

export type EnvelopeType =
  | "presence"
  | "connect-request"
  | "connect-response"
  | "session-established"
  | "session-ended"
  | "heartbeat"
  | "command"
  | "request"
  | "approval"
  | "activity"
  | "lock"
  | "contract"
  | "ack";

export interface Envelope<T = unknown> {
  id: string; // uuid
  type: EnvelopeType;
  from: Address;
  to: Address;
  /** Absent before pairing; required once in a session. */
  sessionId?: string;
  timestamp: string; // ISO 8601
  payload: T;
}

export const RESERVED_ADDRESSES: ReservedAddress[] = ["coordinator", "broadcast"];

export function isReserved(address: string): address is ReservedAddress {
  return address === "coordinator" || address === "broadcast";
}

// ---------------------------------------------------------------------------
// Connection / session
// ---------------------------------------------------------------------------

/** User -> coordinator, then broadcast to the network group. */
export interface PresencePayload {
  userId: HumanId;
  displayName: string;
  state: PresenceState;
  /** Derived from the shared public IP / LAN subnet; scopes the roster. */
  networkId: string;
  /** Set when reserved. */
  partnerId?: HumanId;
}

/** A -> B. Pairing request. */
export interface ConnectRequestPayload {
  requestId: string;
  fromUser: HumanId;
  fromDisplayName: string;
}

/** B -> A. Pairing response. */
export interface ConnectResponsePayload {
  requestId: string;
  decision: "approve" | "reject";
}

/** Coordinator -> both. Session opened. Each participant brings exactly one agent,
 *  addressed by their own id, so there is no separate agent list. */
export interface SessionEstablishedPayload {
  sessionId: string;
  participants: [HumanId, HumanId];
}

/** Coordinator -> both. Session torn down. */
export interface SessionEndedPayload {
  sessionId: string;
  reason: "ended" | "rejected" | "timeout" | "partner_dropped";
}

/** User -> coordinator. Keep-alive; missing beats -> offline + teardown. */
export interface HeartbeatPayload {
  userId: HumanId;
  ts: string;
}

// ---------------------------------------------------------------------------
// Development coordination (active only inside a session)
// ---------------------------------------------------------------------------

/** Human -> own agent. Goes through that agent's FIFO queue. */
export interface CommandPayload {
  /** Natural-language instruction. */
  intent: string;
  /** Files/modules it expects to touch — leased before execution. This, not a role,
   *  is what keeps two agents off the same code. */
  scope: string[];
  priority: "normal" | "urgent";
}

/** Agent -> the other agent. The cross-agent handshake. Proposed, NOT executed. */
export interface RequestPayload {
  requestId: string;
  /** e.g. "login form should POST to /v2/auth". */
  summary: string;
  proposedContract?: ContractPayload;
  /** Does the requester wait on this? */
  blocking: boolean;
}

/** Response to a request. */
export interface ApprovalPayload {
  requestId: string;
  decision: "accept" | "reject" | "renegotiate";
  reason?: string;
  counterProposal?: Partial<RequestPayload>;
}

/** Any agent -> broadcast. Observability. Read-only, drives the dashboard. */
export interface ActivityPayload {
  status: "started" | "progress" | "completed" | "failed" | "idle";
  task: string;
  /** e.g. "editing auth.service.ts", "running tests". */
  currentAction: string;
  filesTouched: string[];
  /** Which command this belongs to. */
  commandId?: string;
}

/** Agent -> coordinator. Resource leasing. */
export interface LockPayload {
  action: "acquire" | "release";
  /** Path or module id. */
  resource: string;
  /** Default 300000; auto-expires. */
  leaseMs?: number;
}

/** Any agent -> broadcast when the API contract changes. */
export interface ContractPayload {
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  requestSchema: object;
  responseSchema: object;
  version: string;
  breaking: boolean;
}

/** Coordinator/agent confirms receipt, queue position, or lock decision. */
export interface AckPayload {
  /** id of the message being acked. */
  refId: string;
  status: "queued" | "granted" | "denied" | "received";
  queuePosition?: number;
  /** Why a `denied` happened. Not in the minimum schema, but a bare denial is
   *  undebuggable across two machines. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Payload map — lets the client type `on(type, handler)` precisely.
// ---------------------------------------------------------------------------

export interface PayloadByType {
  presence: PresencePayload;
  "connect-request": ConnectRequestPayload;
  "connect-response": ConnectResponsePayload;
  "session-established": SessionEstablishedPayload;
  "session-ended": SessionEndedPayload;
  heartbeat: HeartbeatPayload;
  command: CommandPayload;
  request: RequestPayload;
  approval: ApprovalPayload;
  activity: ActivityPayload;
  lock: LockPayload;
  contract: ContractPayload;
  ack: AckPayload;
}

// ---------------------------------------------------------------------------
// Transport constants + connection handshake
// ---------------------------------------------------------------------------

/** Single socket.io event name. Every message — in both directions — rides it. */
export const WIRE_EVENT = "envelope";
/** Server -> client, whole-roster snapshot for the network group. Convenience only;
 *  every entry is also derivable from the `presence` stream. */
export const ROSTER_EVENT = "roster";
/** Server -> client, full session state snapshot (queues, locks, inbox, contracts). */
export const SNAPSHOT_EVENT = "snapshot";

export const DEFAULT_LEASE_MS = 300_000; // 5 min
export const CONNECT_REQUEST_TIMEOUT_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;
/** Three missed beats. */
export const HEARTBEAT_TIMEOUT_MS = 16_000;
export const DEFAULT_SERVER_PORT = 4141;

/** socket.io `auth` block. Identity is established once, at connect time. */
export interface HandshakeAuth {
  userId: HumanId;
  displayName: string;
  /** 'human' drives a dashboard; 'agent' is the coding agent that human owns.
   *  This is the only distinction between connections — agents have no other role. */
  role: "human" | "agent";
  /** Dev-only network-group override. Ignored unless the server was started with
   *  COORD_ALLOW_NETWORK_OVERRIDE=1 — otherwise the group is derived from the source IP. */
  networkIdOverride?: string;
}

// ---------------------------------------------------------------------------
// Observable server state (dashboard read models)
// ---------------------------------------------------------------------------

export interface RosterEntry {
  userId: HumanId;
  displayName: string;
  state: PresenceState;
  networkId: string;
  partnerId?: HumanId;
  /** True when this human's agent process is also connected. */
  agentOnline: boolean;
}

export type QueuedCommandStatus = "queued" | "waiting-on-locks" | "running" | "done" | "failed";

export interface QueuedCommand {
  /** The envelope id of the originating `command` — commands are addressed by it. */
  id: string;
  /** Whose agent this belongs to. */
  agent: AgentRef;
  issuedBy: HumanId;
  intent: string;
  scope: string[];
  priority: "normal" | "urgent";
  status: QueuedCommandStatus;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Set when the command was born from an accepted cross-agent request. */
  originRequestId?: string;
  /** Populated while status is 'waiting-on-locks'. */
  blockedOn?: string[];
}

export interface HeldLock {
  resource: string;
  holder: AgentRef;
  commandId?: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface PendingApproval {
  requestId: string;
  from: AgentRef;
  to: AgentRef;
  summary: string;
  blocking: boolean;
  proposedContract?: ContractPayload;
  receivedAt: string;
}

export interface ActivityEntry {
  id: string;
  agent: AgentRef;
  at: string;
  payload: ActivityPayload;
}

/** Everything the dashboard renders for an active session. */
export interface SessionSnapshot {
  sessionId: string;
  participants: [HumanId, HumanId];
  startedAt: string;
  /** Keyed by agent owner. */
  queues: Record<string, QueuedCommand[]>;
  locks: HeldLock[];
  approvals: PendingApproval[];
  contracts: ContractPayload[];
  activity: ActivityEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;

/** uuid v4 where available (node 20+, modern browsers), with a deterministic-ish fallback. */
export function newId(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  counter += 1;
  return `id-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeEnvelope<K extends EnvelopeType>(
  type: K,
  from: Address,
  to: Address,
  payload: PayloadByType[K],
  sessionId?: string,
): Envelope<PayloadByType[K]> {
  return {
    id: newId(),
    type,
    from,
    to,
    ...(sessionId ? { sessionId } : {}),
    timestamp: new Date().toISOString(),
    payload,
  };
}

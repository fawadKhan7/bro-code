/** Runtime validation for everything arriving over the wire.
 *
 *  The coordination server trusts nothing a socket sends: an envelope that fails
 *  parsing is answered with `ack: denied` and dropped, never partially applied.
 */
import { z } from "zod";

const humanId = z.string().min(1).max(64);
/** Any address: a participant id, or one of the reserved routing addresses. Agents
 *  carry no role, so an agent address is simply its owner's id. */
const address = z.string().min(1).max(64);

export const presenceStateSchema = z.enum(["available", "pending", "reserved", "offline"]);

export const contractPayloadSchema = z.object({
  endpoint: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  requestSchema: z.record(z.unknown()),
  responseSchema: z.record(z.unknown()),
  version: z.string().min(1),
  breaking: z.boolean(),
});

export const presencePayloadSchema = z.object({
  userId: humanId,
  displayName: z.string().min(1).max(64),
  state: presenceStateSchema,
  networkId: z.string().min(1),
  partnerId: humanId.optional(),
});

export const connectRequestPayloadSchema = z.object({
  requestId: z.string().min(1),
  fromUser: humanId,
  fromDisplayName: z.string().min(1),
});

export const connectResponsePayloadSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
});

export const sessionEstablishedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  participants: z.tuple([humanId, humanId]),
});

export const sessionEndedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.enum(["ended", "rejected", "timeout", "partner_dropped"]),
});

export const heartbeatPayloadSchema = z.object({
  userId: humanId,
  ts: z.string().min(1),
});

export const commandPayloadSchema = z.object({
  intent: z.string().min(1).max(4000),
  scope: z.array(z.string().min(1)).max(200),
  priority: z.enum(["normal", "urgent"]),
});

export const requestPayloadSchema = z.object({
  requestId: z.string().min(1),
  summary: z.string().min(1).max(4000),
  proposedContract: contractPayloadSchema.optional(),
  blocking: z.boolean(),
});

export const approvalPayloadSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["accept", "reject", "renegotiate"]),
  reason: z.string().max(2000).optional(),
  counterProposal: requestPayloadSchema.partial().optional(),
});

export const activityPayloadSchema = z.object({
  status: z.enum(["started", "progress", "completed", "failed", "idle"]),
  task: z.string().max(2000),
  currentAction: z.string().max(2000),
  filesTouched: z.array(z.string()).max(500),
  commandId: z.string().optional(),
});

export const lockPayloadSchema = z.object({
  action: z.enum(["acquire", "release"]),
  resource: z.string().min(1).max(1024),
  leaseMs: z.number().int().positive().max(3_600_000).optional(),
});

export const ackPayloadSchema = z.object({
  refId: z.string().min(1),
  status: z.enum(["queued", "granted", "denied", "received"]),
  queuePosition: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
});

/** Payload schema per envelope type. */
const payloadSchemas = {
  presence: presencePayloadSchema,
  "connect-request": connectRequestPayloadSchema,
  "connect-response": connectResponsePayloadSchema,
  "session-established": sessionEstablishedPayloadSchema,
  "session-ended": sessionEndedPayloadSchema,
  heartbeat: heartbeatPayloadSchema,
  command: commandPayloadSchema,
  request: requestPayloadSchema,
  approval: approvalPayloadSchema,
  activity: activityPayloadSchema,
  lock: lockPayloadSchema,
  contract: contractPayloadSchema,
  ack: ackPayloadSchema,
} as const;

const envelopeHeadSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "presence",
    "connect-request",
    "connect-response",
    "session-established",
    "session-ended",
    "heartbeat",
    "command",
    "request",
    "approval",
    "activity",
    "lock",
    "contract",
    "ack",
  ]),
  from: address,
  to: address,
  sessionId: z.string().min(1).optional(),
  timestamp: z.string().min(1),
  payload: z.unknown(),
});

export const handshakeAuthSchema = z.object({
  userId: humanId,
  displayName: z.string().min(1).max(64),
  role: z.enum(["human", "agent"]),
  networkIdOverride: z.string().min(1).max(64).optional(),
});

export type ParseResult =
  | { ok: true; envelope: import("./protocol.js").Envelope }
  | { ok: false; error: string };

/** Validate head then payload, so the error names the offending field. */
export function parseEnvelope(raw: unknown): ParseResult {
  const head = envelopeHeadSchema.safeParse(raw);
  if (!head.success) return { ok: false, error: `envelope: ${formatIssues(head.error)}` };

  const schema = payloadSchemas[head.data.type];
  const payload = schema.safeParse(head.data.payload);
  if (!payload.success) return { ok: false, error: `${head.data.type} payload: ${formatIssues(payload.error)}` };

  return { ok: true, envelope: { ...head.data, payload: payload.data } as import("./protocol.js").Envelope };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
    .join("; ");
}

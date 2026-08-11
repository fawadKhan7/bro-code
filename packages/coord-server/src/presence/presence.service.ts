/** Presence: who is online in each network group, what state they're in, and
 *  whether they're still beating.
 *
 *  State machine (per user):
 *    offline    --connect + heartbeat--> available
 *    available  --send/recv request----> pending
 *    pending    --approved------------->  reserved
 *    pending    --rejected/timeout----->  available
 *    reserved   --session end/drop---->  available
 *    any        --disconnect/no beat-->  offline
 */
import { Injectable, Logger } from "@nestjs/common";
import { HEARTBEAT_TIMEOUT_MS, type HumanId, type PresenceState, type RosterEntry } from "@duo/coord-client";
import { SessionRegistry } from "../session/session.registry.js";
import type { Connection } from "../session/session.types.js";

interface PresenceRecord {
  userId: HumanId;
  displayName: string;
  state: PresenceState;
  networkId: string;
  partnerId?: HumanId;
  lastBeat: number;
}

/** Legal transitions. Anything not listed here is a bug, not a request to honour. */
const ALLOWED: Record<PresenceState, PresenceState[]> = {
  offline: ["available"],
  available: ["pending", "offline", "available"],
  pending: ["reserved", "available", "offline"],
  reserved: ["available", "offline"],
};

@Injectable()
export class PresenceService {
  private readonly log = new Logger("Presence");
  private readonly records = new Map<HumanId, PresenceRecord>();
  private readonly offlineHandlers = new Set<(userId: HumanId) => void>();

  constructor(private readonly registry: SessionRegistry) {}

  /** Called for every new socket. The first one brings the user online. */
  register(connection: Connection, now = Date.now()): PresenceRecord {
    const existing = this.records.get(connection.userId);
    if (existing) {
      // The human owns their display name; an agent process attaching later must not
      // rename them in everyone else's roster.
      if (connection.role === "human") existing.displayName = connection.displayName;
      existing.networkId = connection.networkId;
      existing.lastBeat = now;
      // A reconnect after a missed-beat sweep puts them back in the roster.
      if (existing.state === "offline") existing.state = "available";
      return existing;
    }
    const record: PresenceRecord = {
      userId: connection.userId,
      displayName: connection.displayName,
      state: "available",
      networkId: connection.networkId,
      lastBeat: now,
    };
    this.records.set(connection.userId, record);
    return record;
  }

  get(userId: HumanId): PresenceRecord | undefined {
    return this.records.get(userId);
  }

  stateOf(userId: HumanId): PresenceState {
    return this.records.get(userId)?.state ?? "offline";
  }

  isAvailable(userId: HumanId): boolean {
    return this.stateOf(userId) === "available";
  }

  networkOf(userId: HumanId): string | undefined {
    return this.records.get(userId)?.networkId;
  }

  /** Returns false — and changes nothing — if the transition is illegal. */
  setState(userId: HumanId, state: PresenceState, partnerId?: HumanId): boolean {
    const record = this.records.get(userId);
    if (!record) return false;
    if (record.state !== state && !ALLOWED[record.state].includes(state)) {
      this.log.warn(`refused presence transition ${userId}: ${record.state} -> ${state}`);
      return false;
    }
    record.state = state;
    if (state === "reserved") record.partnerId = partnerId;
    else delete record.partnerId;
    return true;
  }

  beat(userId: HumanId, now = Date.now()): void {
    const record = this.records.get(userId);
    if (!record) return;
    record.lastBeat = now;
    if (record.state === "offline") record.state = "available";
  }

  /** All sockets for this user are gone. */
  forget(userId: HumanId): PresenceRecord | undefined {
    const record = this.records.get(userId);
    this.records.delete(userId);
    return record;
  }

  /** Mark stale users offline. Returns those that just transitioned so the caller
   *  can tear down their sessions. */
  sweep(now = Date.now(), timeoutMs = HEARTBEAT_TIMEOUT_MS): HumanId[] {
    const dropped: HumanId[] = [];
    for (const record of this.records.values()) {
      if (record.state === "offline") continue;
      if (now - record.lastBeat <= timeoutMs) continue;
      record.state = "offline";
      delete record.partnerId;
      dropped.push(record.userId);
      this.log.warn(`${record.userId} missed heartbeats — marked offline`);
    }
    for (const userId of dropped) for (const handler of this.offlineHandlers) handler(userId);
    return dropped;
  }

  onOffline(handler: (userId: HumanId) => void): () => void {
    this.offlineHandlers.add(handler);
    return () => this.offlineHandlers.delete(handler);
  }

  /** The roster is scoped to one network group and never leaks across groups. */
  roster(networkId: string): RosterEntry[] {
    return [...this.records.values()]
      .filter((record) => record.networkId === networkId)
      .map((record) => ({
        userId: record.userId,
        displayName: record.displayName,
        state: record.state,
        networkId: record.networkId,
        ...(record.partnerId ? { partnerId: record.partnerId } : {}),
        agentOnline: this.registry.hasRole(record.userId, "agent"),
      }))
      .sort((a, b) => a.userId.localeCompare(b.userId));
  }

  /** Distinct groups with at least one member — used to fan roster updates out. */
  networks(): string[] {
    return [...new Set([...this.records.values()].map((r) => r.networkId))];
  }
}

/** Per-agent FIFO command queues.
 *
 *  The non-negotiable invariant lives here: at most one command per agent is ever
 *  in flight. Both humans may submit to an agent — the queue orders them. Nothing
 *  is executed inline; the coordinator dispatches the head only once it holds every
 *  lock in that command's scope.
 */
import { Injectable, Logger } from "@nestjs/common";
import type { CommandPayload, HumanId, QueuedCommand } from "@duo/coord-client";
import { LockService } from "../lock/lock.service.js";
import type { AgentRef } from "../session/session.types.js";

export type QueueEvent =
  | { kind: "enqueued"; sessionId: string; agent: AgentRef; command: QueuedCommand; position: number }
  | { kind: "started"; sessionId: string; agent: AgentRef; command: QueuedCommand }
  | { kind: "blocked"; sessionId: string; agent: AgentRef; command: QueuedCommand; blockedOn: string[] }
  | { kind: "finished"; sessionId: string; agent: AgentRef; command: QueuedCommand };

const HISTORY_LIMIT = 25;
/** How much finished work the dashboard shows under each queue. */
const HISTORY_SHOWN = 8;

interface AgentQueue {
  /** queued | waiting-on-locks | running, in execution order. */
  active: QueuedCommand[];
  /** done | failed, newest last. */
  history: QueuedCommand[];
}

export interface EnqueueInput {
  /** The originating envelope id — commands are addressed by it end to end. */
  id: string;
  issuedBy: HumanId;
  payload: CommandPayload;
  originRequestId?: string;
}

@Injectable()
export class QueueService {
  private readonly log = new Logger("Queue");
  private readonly queues = new Map<string, Map<AgentRef, AgentQueue>>();
  private readonly eventHandlers = new Set<(event: QueueEvent) => void>();
  private dispatcher: ((sessionId: string, agent: AgentRef, command: QueuedCommand) => void) | null = null;

  constructor(private readonly locks: LockService) {
    // Freed resources may unblock a command sitting at the head of a queue.
    this.locks.onRelease((sessionId) => this.pumpSession(sessionId));
  }

  /** How a `running` command reaches the agent process. Set once, at wiring time. */
  onDispatch(dispatcher: (sessionId: string, agent: AgentRef, command: QueuedCommand) => void): void {
    this.dispatcher = dispatcher;
  }

  onEvent(handler: (event: QueueEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  // -- queue operations -----------------------------------------------------

  /** Returns the 1-based position, counting the in-flight command as position 1. */
  enqueue(sessionId: string, agent: AgentRef, input: EnqueueInput): number {
    const queue = this.queueFor(sessionId, agent);
    const command: QueuedCommand = {
      id: input.id,
      agent,
      issuedBy: input.issuedBy,
      intent: input.payload.intent,
      scope: input.payload.scope,
      priority: input.payload.priority,
      status: "queued",
      enqueuedAt: new Date().toISOString(),
      ...(input.originRequestId ? { originRequestId: input.originRequestId } : {}),
    };

    // 'urgent' jumps ahead of queued 'normal' work — but never ahead of the command
    // already running. Preempting in flight would break serialization.
    if (command.priority === "urgent") {
      let insertAt = queue.active.length;
      for (let i = 0; i < queue.active.length; i += 1) {
        const item = queue.active[i];
        if (item.status === "running" || item.priority === "urgent") continue;
        insertAt = i;
        break;
      }
      queue.active.splice(insertAt, 0, command);
    } else {
      queue.active.push(command);
    }

    const position = queue.active.indexOf(command) + 1;
    this.emit({ kind: "enqueued", sessionId, agent, command, position });
    this.pump(sessionId, agent);
    return position;
  }

  /** An agent reported completed/failed for its in-flight command. */
  finish(sessionId: string, agent: AgentRef, commandId: string, outcome: "done" | "failed"): QueuedCommand | undefined {
    const queue = this.queueFor(sessionId, agent);
    const index = queue.active.findIndex((c) => c.id === commandId);
    if (index === -1) return undefined;

    const [command] = queue.active.splice(index, 1);
    command.status = outcome;
    command.finishedAt = new Date().toISOString();
    delete command.blockedOn;
    queue.history.push(command);
    if (queue.history.length > HISTORY_LIMIT) queue.history.splice(0, queue.history.length - HISTORY_LIMIT);

    this.locks.releaseForCommand(sessionId, commandId);
    this.emit({ kind: "finished", sessionId, agent, command });
    this.pump(sessionId, agent);
    return command;
  }

  /** The command an agent is executing right now, if any. */
  running(sessionId: string, agent: AgentRef): QueuedCommand | undefined {
    return this.queueFor(sessionId, agent).active.find((c) => c.status === "running");
  }

  list(sessionId: string): Record<string, QueuedCommand[]> {
    const perAgent = this.queues.get(sessionId);
    const out: Record<string, QueuedCommand[]> = {};
    if (!perAgent) return out;
    for (const [agent, queue] of perAgent) {
      out[agent] = [...queue.active, ...queue.history.slice(-HISTORY_SHOWN)];
    }
    return out;
  }

  disposeSession(sessionId: string): void {
    this.queues.delete(sessionId);
  }

  /** Re-evaluate every agent in a session — used after locks are freed. */
  pumpSession(sessionId: string): void {
    const perAgent = this.queues.get(sessionId);
    if (!perAgent) return;
    for (const agent of perAgent.keys()) this.pump(sessionId, agent);
  }

  // -- internals ------------------------------------------------------------

  /** Start the head command if the agent is idle and its whole scope is lockable. */
  private pump(sessionId: string, agent: AgentRef): void {
    const queue = this.queueFor(sessionId, agent);
    if (queue.active.some((c) => c.status === "running")) return; // one at a time. always.

    const next = queue.active[0];
    if (!next) return;

    const acquired = this.locks.tryAcquireAll(sessionId, agent, next.scope, next.id);
    if (!acquired.ok) {
      const blockedOn = acquired.denied.map((d) => d.resource);
      // Stay at the head and wait. Never proceed partially.
      if (next.status !== "waiting-on-locks" || !sameSet(next.blockedOn, blockedOn)) {
        next.status = "waiting-on-locks";
        next.blockedOn = blockedOn;
        this.emit({ kind: "blocked", sessionId, agent, command: next, blockedOn });
      }
      return;
    }

    next.status = "running";
    next.startedAt = new Date().toISOString();
    delete next.blockedOn;
    this.log.log(`${agent} started ${next.id}: ${next.intent.slice(0, 60)}`);
    this.emit({ kind: "started", sessionId, agent, command: next });
    this.dispatcher?.(sessionId, agent, next);
  }

  private queueFor(sessionId: string, agent: AgentRef): AgentQueue {
    let perAgent = this.queues.get(sessionId);
    if (!perAgent) {
      perAgent = new Map();
      this.queues.set(sessionId, perAgent);
    }
    let queue = perAgent.get(agent);
    if (!queue) {
      queue = { active: [], history: [] };
      perAgent.set(agent, queue);
    }
    return queue;
  }

  private emit(event: QueueEvent): void {
    for (const handler of this.eventHandlers) handler(event);
  }
}

function sameSet(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}

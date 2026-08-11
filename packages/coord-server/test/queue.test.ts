/** The serialization invariant, and the all-or-nothing lock acquisition behind it. */
import { describe, expect, it, beforeEach } from "vitest";
import type { QueuedCommand } from "@duo/coord-client";
import { LockService } from "../src/lock/lock.service.js";
import { QueueService, type QueueEvent } from "../src/queue/queue.service.js";

const SESSION = "sess-1";

describe("command queue", () => {
  let locks: LockService;
  let queue: QueueService;
  let dispatched: QueuedCommand[];
  let events: QueueEvent[];

  beforeEach(() => {
    locks = new LockService();
    queue = new QueueService(locks);
    dispatched = [];
    events = [];
    queue.onDispatch((_sessionId, _agent, command) => dispatched.push(command));
    queue.onEvent((event) => events.push(event));
  });

  const enqueue = (id: string, intent: string, scope: string[] = [], priority: "normal" | "urgent" = "normal") =>
    queue.enqueue(SESSION, "coffee", { id, issuedBy: "coffee", payload: { intent, scope, priority } });

  it("dispatches the first command and holds the rest — one at a time, always", () => {
    expect(enqueue("c1", "add /v2/auth")).toBe(1);
    expect(enqueue("c2", "add rate limiting")).toBe(2);
    expect(enqueue("c3", "write tests")).toBe(3);

    expect(dispatched.map((c) => c.id)).toEqual(["c1"]);
    expect(queue.running(SESSION, "coffee")?.id).toBe("c1");
  });

  it("tells the second commander a task is already running", () => {
    enqueue("c1", "first");
    enqueue("c2", "second");

    const queued = events.filter((e) => e.kind === "enqueued");
    expect(queued.at(-1)).toMatchObject({ position: 2 });
  });

  it("starts the next command only after the previous one finishes", () => {
    enqueue("c1", "first");
    enqueue("c2", "second");
    expect(dispatched).toHaveLength(1);

    queue.finish(SESSION, "coffee", "c1", "done");

    expect(dispatched.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(queue.running(SESSION, "coffee")?.id).toBe("c2");
  });

  it("keeps going after a failed command", () => {
    enqueue("c1", "first");
    enqueue("c2", "second");
    queue.finish(SESSION, "coffee", "c1", "failed");
    expect(dispatched.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("lets urgent work jump the queue but never preempts the running command", () => {
    enqueue("c1", "running");
    enqueue("c2", "normal");
    expect(enqueue("c3", "urgent", [], "urgent")).toBe(2);

    const active = queue.list(SESSION).coffee.filter((c) => c.status !== "done");
    expect(active.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);
    expect(queue.running(SESSION, "coffee")?.id).toBe("c1");
  });

  it("acquires a command's whole scope before starting it", () => {
    enqueue("c1", "edit auth", ["src/auth.ts", "src/user.ts"]);
    expect(locks.held(SESSION).map((l) => l.resource)).toEqual(["src/auth.ts", "src/user.ts"]);
    expect(locks.held(SESSION).every((l) => l.holder === "coffee")).toBe(true);
  });

  it("makes a command wait — not partially proceed — when any lock is denied", () => {
    // The other agent already holds one of the two resources.
    locks.acquire(SESSION, "friend", "shared/contract.ts");

    queue.enqueue(SESSION, "coffee", {
      id: "c1",
      issuedBy: "coffee",
      payload: { intent: "touch both", scope: ["src/a.ts", "shared/contract.ts"], priority: "normal" },
    });

    expect(dispatched).toHaveLength(0);
    const blocked = events.find((e) => e.kind === "blocked");
    expect(blocked).toMatchObject({ blockedOn: ["shared/contract.ts"] });
    // Crucially, it did NOT take the half it could get.
    expect(locks.held(SESSION).map((l) => l.resource)).toEqual(["shared/contract.ts"]);
  });

  it("starts a blocked command as soon as the resource is released", () => {
    locks.acquire(SESSION, "friend", "shared/contract.ts");
    queue.enqueue(SESSION, "coffee", {
      id: "c1",
      issuedBy: "coffee",
      payload: { intent: "touch both", scope: ["src/a.ts", "shared/contract.ts"], priority: "normal" },
    });
    expect(dispatched).toHaveLength(0);

    locks.release(SESSION, "friend", "shared/contract.ts");

    expect(dispatched.map((c) => c.id)).toEqual(["c1"]);
    expect(locks.held(SESSION).map((l) => l.resource).sort()).toEqual(["shared/contract.ts", "src/a.ts"]);
  });

  it("releases the whole scope when a command completes", () => {
    enqueue("c1", "edit", ["src/a.ts", "src/b.ts"]);
    queue.finish(SESSION, "coffee", "c1", "done");
    expect(locks.held(SESSION)).toEqual([]);
  });

  it("auto-expires leases so a dead agent cannot deadlock the other one", () => {
    const now = Date.now();
    locks.acquire(SESSION, "friend", "shared/contract.ts", 1_000, undefined, now);
    queue.enqueue(SESSION, "coffee", {
      id: "c1",
      issuedBy: "coffee",
      payload: { intent: "waits", scope: ["shared/contract.ts"], priority: "normal" },
    });
    expect(dispatched).toHaveLength(0);

    locks.sweep(now + 2_000);

    expect(dispatched.map((c) => c.id)).toEqual(["c1"]);
  });

  it("keeps each agent's queue independent", () => {
    queue.enqueue(SESSION, "coffee", { id: "b1", issuedBy: "coffee", payload: { intent: "b", scope: [], priority: "normal" } });
    queue.enqueue(SESSION, "friend", { id: "f1", issuedBy: "friend", payload: { intent: "f", scope: [], priority: "normal" } });

    expect(queue.running(SESSION, "coffee")?.id).toBe("b1");
    expect(queue.running(SESSION, "friend")?.id).toBe("f1");
    expect(dispatched.map((c) => c.id).sort()).toEqual(["b1", "f1"]);
  });

  it("scopes locks to a session", () => {
    locks.acquire("sess-a", "coffee", "src/app.ts");
    const other = locks.acquire("sess-b", "friend", "src/app.ts");
    expect(other.granted).toBe(true);
  });

  it("treats re-acquiring your own lease as a refresh, not a conflict", () => {
    const now = Date.now();
    locks.acquire(SESSION, "coffee", "src/a.ts", 1_000, undefined, now);
    const again = locks.acquire(SESSION, "coffee", "src/a.ts", 5_000, undefined, now + 500);
    expect(again.granted).toBe(true);
    expect(locks.held(SESSION, now + 2_000)).toHaveLength(1);
  });

  it("refuses to release a lease held by the other agent", () => {
    locks.acquire(SESSION, "coffee", "src/a.ts");
    expect(locks.release(SESSION, "friend", "src/a.ts")).toBe(false);
  });
});

# BroCode Phase 2 — coordination layer

Two AI coding agents on two different machines, working the same product in parallel
without stepping on each other, with both humans able to watch everything.

Phase 1 gave agents a way to talk. This is the control layer on top: who may command
what, in what order, and who has to say yes before work crosses from one agent to the other.

## The model

Three distinct rights. They are deliberately **not** one permission.

| Right | Scope | Enforced by |
|---|---|---|
| **Observe** | Symmetric. Every human sees every agent's activity, always. Read-only, never restricted. | every `activity`, `lock` and `contract` fans out to both participants, unfiltered |
| **Command** | Ownership-scoped. A human commands only their own agent. | a `command` naming the partner's agent is denied — crossing over goes through a request |
| **Approve** | The owner of the receiving agent gates anything crossing into it. | a `request` sits in their inbox as a proposal; only `approval.accept` turns it into a command |

**Agents carry no role.** There is no "backend agent" or "frontend agent" — each participant
brings exactly one agent, and it is addressed by its owner's id. `to: 'coffee'` on a
`command` means coffee's agent.

What keeps the two agents off the same code is the **lock manager**, at the moment work
actually starts: a command declares the files or modules it will touch, and the coordinator
leases them before dispatching. That is a runtime fact about what is being edited right now,
not a territory assigned up front — so either agent can work anywhere, just never on the same
resource at the same time. The API contract is still the thing that crosses between them; it
simply belongs to whoever changes it.

**The invariant:** commands to any single agent are serialized. At most one command per
agent is in flight, ever. The coordinator dispatches the head of the queue only once it
holds every lock in that command's scope, and starts the next one only after the running
command reports `completed` or `failed`.

## Packages

| Path | What |
|---|---|
| [`coord-client/`](coord-client/) | The protocol (envelope + payload types, zod validation) and the typed `CoordClient` adapter. Humans and agents both import this. Also ships `brocode-demo-agent`, a runnable reference agent. |
| [`coord-server/`](coord-server/) | The NestJS coordination server: gateway, presence, pairing, per-agent queues, lock manager, handshake engine, contract broadcaster. Single source of truth, all in memory. |
| [`coord-dashboard/`](coord-dashboard/) | The Next.js observability dashboard. Builds to a **static export** that is staged into `coord-server/dashboard/` and served by the coordination server — there is no Next.js process at runtime. |

These are additive — nothing in `shared/`, `hub/`, `adapters/` or `cli/` changed.

## Run it over a LAN

### 1. On one machine, start the coordination server

```bash
cd packages && npm install && npm run coord
```

It binds `0.0.0.0:4141`, serves the dashboard from the same port, and prints every LAN
address it answers on:

```
coordination server listening on 0.0.0.0:4141
  open http://192.168.1.24:4141
```

Only one of you runs this. Note the address — it is the whole thing your teammate needs.

### 2. Both of you open that address in a browser

```
http://192.168.1.24:4141
```

That is the entire second-machine setup: no install, no `npm`, no separate dashboard
server. Join with your id (`coffee`) and a display name; "Coordination server" already
defaults to wherever the page came from. There is nothing else to choose — your agent is
simply the agent that connects as you.

### 3. On each machine, attach your agent

Your agent connects with the **same `userId`** as the dashboard and `role: 'agent'`. To
see the whole thing move before wiring a real agent, use the reference implementation:

```bash
node coord-client/dist/demoAgent.js --url http://192.168.1.24:4141 --user coffee --name Coffee
```

### 4. Pair

Both of you appear on the roster — you only see people whose sockets reach the
coordinator from your own network. Click **Connect**; the other side gets a prompt with
a 30-second countdown and clicks **Approve**. Both go `reserved`, both receive the same
`sessionId`, and the queues, locks and approval inbox start running scoped to it.

If you both click Connect on each other at the same time, you are paired automatically —
you both wanted it.

### 5. Run a session

The dashboard is read-only apart from Connect and Approve, so commands come from your own
client. With the demo agent:

```bash
node coord-client/dist/demoAgent.js --url http://192.168.1.24:4141 --user coffee \
  --role human --command "add POST /v2/auth" --scope src/auth.service.ts
```

Watch the dashboard: the command is queued (`ack` carries the position), the coordinator
leases `src/auth.service.ts`, dispatches it, and the agent's progress streams to both
humans. Send a second command while the first runs and it waits — both humans see
*"queued at position 2 — a task is already running"* before anyone piles on.

For the cross-agent path, have the other agent propose something:

```bash
node coord-client/dist/demoAgent.js --url http://192.168.1.24:4141 --user friend \
  --propose "login form should POST to /v2/auth"
```

It lands in **coffee's** approval inbox on both dashboards, and coffee's queue does not
move. Only when coffee clicks Accept does it become a real command in their queue — tagged
`via approval`, scoped to `contract:POST /v2/auth`.

## Using the client adapter in a real agent

```ts
import { CoordClient } from "@duo/coord-client";

// No role, no domain: this is coffee's agent because it connects as coffee.
const client = new CoordClient({
  url: "http://192.168.1.24:4141",
  auth: { userId: "coffee", displayName: "Coffee", role: "agent" },
});
await client.connect();

// One command at a time — the coordinator guarantees it, and already holds the locks.
client.onCommand(async (command, envelope) => {
  await client.reportActivity({
    status: "started", task: command.intent,
    currentAction: "reading the affected files",
    filesTouched: command.scope, commandId: envelope.id,
  });

  await doTheWork(command.intent, command.scope);

  // completed | failed is what releases the locks and starts the next command.
  await client.reportActivity({
    status: "completed", task: command.intent, currentAction: "done",
    filesTouched: command.scope, commandId: envelope.id,
  });
});

// Crossing to the other agent: propose, never command.
await client.proposeToPeer(client.peerAgent!, {
  summary: "login form should POST to /v2/auth",
  blocking: true,
  proposedContract: { endpoint: "/v2/auth", method: "POST", requestSchema, responseSchema,
                      version: "2.0.0", breaking: true },
});
```

[`coord-client/src/demoAgent.ts`](coord-client/src/demoAgent.ts) is the full version of
this, and is the file to copy when wiring a real agent.

## How the pieces behave

**Presence.** Every user heartbeats every 5s. Three missed beats and they are marked
`offline`, their session is torn down, and their partner returns to `available`.

**Pairing.** A connect request soft-locks *both* users at `pending`, so no third party can
grab either mid-handshake. 30 seconds with no answer auto-rejects and frees both. A user
is in at most one session, and a request aimed at anyone who is not `available` is refused.

**Queues.** FIFO per agent. `urgent` jumps queued `normal` work but never preempts the
command already running — preemption would break serialization. Both humans' work can land
in one queue: yours directly, your partner's through an accepted request.

**Locks.** Leases by file path or module id, session-scoped, default 5 minutes. This is the
*only* thing preventing two agents from editing the same code, which is why acquisition for
a command's scope is all-or-nothing: if any resource is held by the other agent the command
waits at the head of its queue rather than proceeding with half of what it needs.
Leases auto-expire so a crashed agent cannot deadlock the other one, and release on
`completed`/`failed`.

**Contracts.** Either agent may publish an endpoint change; the peer consumes it and both
dashboards render it, tagged with who published. Latest version per `METHOD /path` wins.

Everything above emits on the bus. If it isn't on the bus, it didn't happen.

## Network groups

The roster is scoped by the socket's **source IP**, never by anything the client claims.
Private addresses group by /24 (one LAN segment); public addresses group by the exact
address (everyone behind one NAT). Loopback is its own group, which is why both sides work
on a single machine.

To run two users on one machine that are *not* on loopback, start the server with
`COORD_ALLOW_NETWORK_OVERRIDE=1` and set the dev "Network group override" field. Behind a
reverse proxy, set `COORD_TRUST_PROXY=1` to read `X-Forwarded-For`.

| Env var | Default | What |
|---|---|---|
| `COORD_PORT` | `4141` | server port |
| `COORD_HOST` | `0.0.0.0` | bind address — localhost-only defeats the point |
| `COORD_ALLOW_NETWORK_OVERRIDE` | off | let clients name their own network group (dev only) |
| `COORD_TRUST_PROXY` | off | derive the group from `X-Forwarded-For` |

## Tests

```bash
cd packages && npm run test:coord
```

47 tests: pairing and presence state machine, queue serialization and lock behaviour, the
handshake engine, plus an end-to-end run over real sockets with two humans and two agents
covering the whole session lifecycle.

## Running inside the desktop app

[`packages/app`](app/) hosts the whole thing. It manages both servers in-process, each
probe-or-own: it attaches to a hub or coordination server that is already listening (a `duo`
CLI session, a `npm run coord` session) and otherwise starts its own. On quit it stops
**only** what it started — see [`app/src/coordination.ts`](app/src/coordination.ts).

There are no child processes and no bundler to supervise, because each server serves its own
dashboard: **Open BroCode** in the tray opens the hub window, **Open coordination** opens the
Phase 2 view. Both are localhost URLs into servers already running in the main process.

Because the coordination server listens on `0.0.0.0`, running the app is also what *hosts*
the session for your teammate — they open `http://<your-lan-ip>:4141` in an ordinary browser
and need nothing installed.

A failure to start the coordination server is logged and non-fatal: single-machine hub
sessions still work, and the tray item explains what is missing.

### Build layout

| Command | What |
|---|---|
| `npm run build:coord` | TypeScript only (client + server). Fast; what `test:coord` uses. |
| `npm run build:coord:dashboard` | The above, plus `next build` → static export → staged into `coord-server/dashboard/`. |
| `npm run coord` | Full build, then run the server. |
| `npm run coord:dev-dashboard` | `next dev` on :4142 with hot reload, against a server on :4141. For working on the dashboard itself. |

`coord-server/dashboard/` is generated and git-ignored; it ships inside the package (and
therefore inside the packaged desktop app) via `files`.

## Not in this phase

A central orchestrator agent, sessions with 3+ participants, and cross-network transport
are Phase 3. The interfaces leave room for them — sessions hold a participant list rather
than an A/B pair, queues and locks are keyed by agent rather than by any fixed pair, and
routing is already scoped per session rather than global — but none of it is built.

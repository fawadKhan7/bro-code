# BroCode Phase 2 — live demo runbook

One command, two browser windows, four beats. Rehearsed end to end.

## Start it

```bash
cd packages && npm run demo:coord
```

That builds everything, starts the coordination server, and attaches both agents. It
prints two URLs. Open them **side by side** — they auto-join, so there is no form to
fill on stage:

```
http://<your-ip>:4141/?user=coffee&name=Coffee
http://<your-ip>:4141/?user=friend&name=Friend
```

Ctrl-C stops everything.

## The four beats

### 1. Pair — "access is not one permission"

Click **Connect** on one window. The other gets a prompt with a 30-second countdown.
Click **Approve**. Both flip to `reserved`.

> While that request is in flight, both people are soft-locked — nobody else can grab
> either of them mid-handshake. Discovery is scoped to the network, so you only ever
> see people on your own LAN.

### 2. Serialization — "two commands, one agent, no race"

```bash
node coord-client/dist/demoAgent.js --url http://127.0.0.1:4141 --user coffee \
  --role human --command "add POST /v2/auth" --scope src/auth.service.ts

node coord-client/dist/demoAgent.js --url http://127.0.0.1:4141 --user coffee \
  --role human --command "add rate limiting" --scope src/limiter.ts
```

First returns `queued at position 1`, second `queued at position 2`.

> Point at the dashboard: the second command says *"queued at position 2 — a task is
> already running"*. Both humans see that before anyone piles on. The coordinator holds
> the file locks for the running command and only starts the next one when it reports
> completion — one command per agent in flight, ever.

### 3. The boundary — "you cannot reach into someone else's agent"

```bash
node coord-client/dist/demoAgent.js --url http://127.0.0.1:4141 --user friend \
  --role human --command "rewrite coffee's auth" --scope src/auth.service.ts --target coffee
```

```
denied: you command your own agent, not 'coffee' — send a cross-agent request instead
```

> This is the whole point of the layer. There is no path from one person to the other
> person's agent that skips consent.

### 4. The handshake — "consent, then work"

```bash
node coord-client/dist/demoAgent.js --url http://127.0.0.1:4141 --user friend --role human \
  --command "propose: login form should POST to /v2/auth" --scope src/login.tsx
```

It lands in Coffee's **Cross-agent approvals** inbox on *both* dashboards. Coffee's queue
does not move. Click **Accept** on Coffee's window.

> Only now does it become a real command in Coffee's queue — tagged `via approval`,
> `urgent` because the other agent is blocked on it, and scoped to the contract so
> nothing else can touch that endpoint concurrently. It runs, publishes the API contract,
> and the other agent picks it up. That is the full loop: propose → approve → execute →
> contract broadcast.

Close on the **Activity** panel: every state change is on the bus, and both humans saw
all of it, unfiltered, the whole time.

## Pre-flight (five minutes before)

```bash
cd packages
lsof -ti:4141 | xargs kill -9 2>/dev/null   # free the port
npm run demo:coord                           # then Ctrl-C once it prints the URLs
```

- **Use one machine.** Both windows on loopback are always in the same network group.
  Two real machines only see each other on the **same /24 subnet** — one on wifi and one
  on ethernet will not find each other.
- **Wired or stable wifi** if you do use two machines, and expect a macOS firewall prompt
  the first time the server binds `0.0.0.0`.
- **If Electron ever gets SIGKILL'd** after an `npm install`:
  ```bash
  codesign --force --deep --sign - node_modules/electron/dist/Electron.app
  ```
- Fresh browser windows are not required — the `?user=` links bypass stored identity, so
  the two tabs cannot clobber each other.

## Two things to be straight about if asked

**The agents are simulated.** `demoAgent.js` is the reference client adapter: it accepts a
command, reports the same activity a real agent would, and sleeps instead of editing code.
This demo proves the *coordination layer* — pairing, serialization, locks, approvals,
contracts. Wiring a real Claude Code or Cursor agent to it is [a thin adapter](COORDINATION.md#using-the-client-adapter-in-a-real-agent),
not a rewrite, but it is not what is on screen.

**There is no authentication.** Anyone who can reach port 4141 can join as any id and
observe everything. It is a trusted-LAN tool as built. Fine on a demo network; worth
naming before someone asks.

## If something goes wrong live

| Symptom | Fix |
|---|---|
| Roster shows only one person | The other window's agent didn't attach — check the demo process output |
| Connect button disabled | That person is `pending` or `reserved`; wait 30s for the request to time out |
| Prompt never appeared | The 30s window elapsed — click Connect again |
| Nothing responds | Ctrl-C and re-run `npm run demo:coord`; state is all in memory, so restart is clean |

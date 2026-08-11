#!/usr/bin/env node
/** One-command demo: coordination server + both agents, in a single process.
 *
 *  Everything a live walkthrough needs, with nothing to start in the right order and
 *  nothing to type on stage. Run it, open the two printed URLs, and drive.
 *
 *    node coord-server/scripts/demo.mjs
 *
 *  The agents are the reference implementation from coord-client — they simulate work
 *  on a timer. This demonstrates the coordination layer (pairing, serialization, locks,
 *  approvals), not a real coding agent editing files.
 */
import * as os from "node:os";
import { createCoordinationApp, dashboardDir } from "../dist/index.js";
import { CoordClient } from "@duo/coord-client";

const PORT = Number(process.env.COORD_PORT ?? 4141);
const WORK_MS = Number(process.env.DEMO_WORK_MS ?? 2500);
const PEOPLE = [
  { userId: "coffee", displayName: "Coffee" },
  { userId: "friend", displayName: "Friend" },
];

function lanAddress() {
  const found = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .find((entry) => entry.family === "IPv4" && !entry.internal);
  return found?.address ?? "localhost";
}

async function portFree(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(600) });
    return !res.ok;
  } catch {
    return true;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const contractFor = (endpoint) => ({
  endpoint,
  method: "POST",
  requestSchema: { email: "string", password: "string" },
  responseSchema: { token: "string", expiresIn: "number" },
  version: "2.0.0",
  breaking: true,
});

/** A scripted agent: one command at a time, narrating each step onto the bus.
 *
 *  Two behaviours beyond plain work, so the whole model is demonstrable from the
 *  human side alone:
 *    `propose: <summary>`  → sends a cross-agent proposal instead of doing the work
 *    a command scoped to `contract:METHOD /path` → publishes that contract when done,
 *    which is what an approved cross-agent request turns into.
 */
async function startAgent({ userId, displayName }, url) {
  const client = new CoordClient({ url, auth: { userId, displayName, role: "agent" } });
  await client.connect();

  client.onCommand(async (command, envelope) => {
    const say = (status, currentAction) =>
      client.reportActivity({
        status,
        task: command.intent,
        currentAction,
        filesTouched: command.scope,
        commandId: envelope.id,
      });

    console.log(`  ${userId} ▸ ${command.intent}`);
    await say("started", "reading the affected files");
    await sleep(WORK_MS / 2);

    if (command.intent.startsWith("propose:")) {
      const summary = command.intent.slice("propose:".length).trim();
      const peer = client.peerAgent;
      if (peer) {
        await client.proposeToPeer(peer, { summary, blocking: true, proposedContract: contractFor("/v2/auth") });
        await say("completed", `proposed to ${peer} — waiting on their approval`);
        console.log(`  ${userId} → proposal sent to ${peer}`);
        return;
      }
    }

    await say("progress", command.scope.length ? `editing ${command.scope[0]}` : "working");
    await sleep(WORK_MS / 2);

    // An approved cross-agent request arrives scoped to the contract it settled.
    const settled = command.scope.find((entry) => entry.startsWith("contract:"));
    if (settled) {
      const endpoint = settled.split(" ").slice(1).join(" ");
      await client.publishContract(contractFor(endpoint));
      console.log(`  ${userId} ⇄ published contract ${endpoint}`);
    }

    // completed is what releases the locks and lets the next command start.
    await say("completed", "done");
    console.log(`  ${userId} ✓ ${command.intent}`);
  });

  return client;
}

async function main() {
  if (!(await portFree(PORT))) {
    console.error(`✗ something is already listening on :${PORT}. Stop it first, or set COORD_PORT.`);
    process.exit(1);
  }
  if (!dashboardDir()) {
    console.error("✗ dashboard not staged. Run: npm run build:coord:dashboard");
    process.exit(1);
  }

  const app = await createCoordinationApp({ quiet: true });
  await app.listen(PORT, "0.0.0.0");

  const url = `http://127.0.0.1:${PORT}`;
  const agents = [];
  for (const person of PEOPLE) agents.push(await startAgent(person, url));

  const host = lanAddress();
  const link = (p) => `http://${host}:${PORT}/?user=${p.userId}&name=${p.displayName}`;

  console.log(`
  BroCode coordination — demo ready

  Open these two, side by side (they auto-join, no form to fill):

    ${link(PEOPLE[0])}
    ${link(PEOPLE[1])}

  Both agents are attached and idle. Then:

    1. Click Connect on one, Approve on the other       → paired
    2. Queue two commands and watch the second wait:

       node coord-client/dist/demoAgent.js --url ${url} --user coffee \\
         --role human --command "add POST /v2/auth" --scope src/auth.service.ts

       node coord-client/dist/demoAgent.js --url ${url} --user coffee \\
         --role human --command "add rate limiting" --scope src/limiter.ts

    3. Try to command the OTHER person's agent — refused by design:

       node coord-client/dist/demoAgent.js --url ${url} --user friend \\
         --role human --command "rewrite coffee's auth" --scope src/auth.service.ts --target coffee

    4. Cross-agent proposal → lands in Coffee's inbox and does nothing until Accept,
       then becomes a real command in Coffee's queue and publishes the contract:

       node coord-client/dist/demoAgent.js --url ${url} --user friend --role human \\
         --command "propose: login form should POST to /v2/auth" --scope src/login.tsx

  Teammates on this network can join from any browser at http://${host}:${PORT}
  Ctrl-C to stop everything.
`);

  const shutdown = async () => {
    for (const agent of agents) agent.disconnect();
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/** A runnable reference implementation of the client adapter.
 *
 *  Two modes, both thin wrappers over {@link CoordClient} — this is roughly all the
 *  glue a real agent needs:
 *
 *    agent  (default)  attach a coding agent to its owner: pull one command at a time,
 *                      report activity, optionally propose a change to the peer agent.
 *    human  --command  issue a command to your own agent from a terminal, since the
 *                      dashboard is deliberately read-only.
 *
 *  Agents carry no role — an agent simply belongs to the user it connects as, and is
 *  addressed by that id.
 *
 *  Examples:
 *    brocode-demo-agent --url http://192.168.1.24:4141 --user coffee
 *    brocode-demo-agent --role human --user coffee \
 *        --command "add POST /v2/auth" --scope src/auth.service.ts
 */
import { DEFAULT_SERVER_PORT, type ContractPayload } from "./protocol.js";
import { CoordClient } from "./client.js";

interface Options {
  url: string;
  userId: string;
  displayName: string;
  role: "agent" | "human";
  command?: string;
  /** Whose agent to command. Defaults to your own — which is the only one allowed. */
  target?: string;
  scope: string[];
  priority: "normal" | "urgent";
  propose?: string;
  contract?: string;
  networkIdOverride?: string;
  /** How long the demo agent pretends to work on each command. */
  workMs: number;
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, "true");
    }
  }

  const userId = flags.get("user") ?? process.env.COORD_USER ?? "agent";
  return {
    url: flags.get("url") ?? process.env.COORD_URL ?? `http://localhost:${DEFAULT_SERVER_PORT}`,
    userId,
    displayName: flags.get("name") ?? userId,
    role: flags.get("role") === "human" ? "human" : "agent",
    command: flags.get("command"),
    target: flags.get("target"),
    scope: (flags.get("scope") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    priority: flags.get("priority") === "urgent" ? "urgent" : "normal",
    propose: flags.get("propose"),
    contract: flags.get("contract"),
    networkIdOverride: flags.get("network"),
    workMs: Number(flags.get("work-ms") ?? 2500),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function demoContract(endpoint: string): ContractPayload {
  return {
    endpoint,
    method: "POST",
    requestSchema: { email: "string", password: "string" },
    responseSchema: { token: "string", expiresIn: "number" },
    version: "2.0.0",
    breaking: true,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new CoordClient({
    url: options.url,
    auth: {
      userId: options.userId,
      displayName: options.displayName,
      role: options.role,
      ...(options.networkIdOverride ? { networkIdOverride: options.networkIdOverride } : {}),
    },
  });

  client.on("error", ({ message }) => console.error(`! ${message}`));

  await client.connect();
  console.log(`connected to ${options.url} as ${options.userId} (${options.role})`);

  // --- human: fire one command into your own agent's queue and leave -------
  if (options.role === "human") {
    if (!options.command) {
      console.error("--role human needs --command \"...\"");
      process.exit(2);
    }
    // The session has to exist first — pair up in the dashboard.
    const session = await waitForSession(client);
    console.log(`session ${session}`);
    // Defaults to your own agent — the only one you may command. Passing --target
    // with someone else's id is how you show the coordinator refusing it.
    const ack = await client.sendCommand(
      { intent: options.command, scope: options.scope, priority: options.priority },
      options.target ?? client.agent,
    );
    console.log(
      ack.status === "queued"
        ? `queued at position ${ack.queuePosition}`
        : `${ack.status}${ack.reason ? `: ${ack.reason}` : ""}`,
    );
    client.disconnect();
    return;
  }

  // --- agent: one command at a time, reporting everything to the bus -------
  client.on("session-established", ({ payload }) => console.log(`session ${payload.sessionId} established`));
  client.on("session-ended", ({ payload }) => console.log(`session ended (${payload.reason})`));
  client.on("contract", ({ payload }) =>
    console.log(`peer contract: ${payload.method} ${payload.endpoint} v${payload.version}${payload.breaking ? " BREAKING" : ""}`),
  );
  client.on("approval", ({ payload }) => console.log(`approval for ${payload.requestId}: ${payload.decision}`));

  client.onCommand(async (command, envelope) => {
    console.log(`> ${command.intent}`);
    // The coordinator already holds this command's scope; the agent just works.
    await client.reportActivity({
      status: "started",
      task: command.intent,
      currentAction: "reading the affected files",
      filesTouched: command.scope,
      commandId: envelope.id,
    });

    await sleep(options.workMs / 2);
    await client.reportActivity({
      status: "progress",
      task: command.intent,
      currentAction: command.scope.length > 0 ? `editing ${command.scope[0]}` : "thinking",
      filesTouched: command.scope,
      commandId: envelope.id,
    });

    await sleep(options.workMs / 2);
    // completed/failed is what releases the locks and starts the next command.
    await client.reportActivity({
      status: "completed",
      task: command.intent,
      currentAction: "done",
      filesTouched: command.scope,
      commandId: envelope.id,
    });
    console.log(`< done: ${command.intent}`);
  });

  if (options.propose || options.contract) {
    await waitForSession(client);
    const peer = client.peerAgent;
    if (options.contract) {
      await client.publishContract(demoContract(options.contract));
      console.log(`published contract for ${options.contract}`);
    }
    if (options.propose && peer) {
      const ack = await client.proposeToPeer(peer, {
        summary: options.propose,
        blocking: true,
        proposedContract: demoContract("/v2/auth"),
      });
      console.log(`proposal sent to ${peer} (${ack.status}) — waiting on their approval`);
    }
  }

  const shutdown = () => {
    client.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function waitForSession(client: CoordClient): Promise<string> {
  if (client.sessionId) return Promise.resolve(client.sessionId);
  // A client rejoining an existing session is told about it right after connect, so
  // don't announce a wait that is about to be over in a few milliseconds.
  const announce = setTimeout(() => console.log("waiting to be paired…"), 300);
  return new Promise((resolve) => {
    const off = client.on("session-established", ({ payload }) => {
      off();
      clearTimeout(announce);
      resolve(payload.sessionId);
    });
  });
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

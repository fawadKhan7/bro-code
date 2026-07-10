/** `duo start "<goal>"` — the orchestrator. Spawns/reuses the hub, launches agents,
 *  gates on registration, then watches the session live until done.
 */
import { HubClient } from "../hubClient.js";
import { ensureHub } from "../hubProcess.js";
import { requireConfig } from "../context.js";
import { SessionRun, defaultAdapterResolver } from "../sessionRunner.js";
import { renderStatus } from "../render.js";

export interface StartArgs {
  goal: string;
  noPlan: boolean;
  mode?: "auto-run" | "checkpoint";
}

export async function cmdStart(args: StartArgs): Promise<void> {
  const config = requireConfig();
  if (args.mode) config.mode = args.mode;

  console.log(`Starting session: "${args.goal}"`);
  const hub = await ensureHub(config.port);
  console.log(`  Hub ${hub.spawned ? "started" : "reused"} on ${hub.url}`);

  const client = new HubClient(hub.url);
  const existing = (await client.status()) as { active?: boolean };
  if (existing.active) {
    console.error("✗ A session is already active. Run `duo stop` first, or `duo status` to see it.");
    process.exit(1);
  }

  const run = new SessionRun(config, client, hub.url, defaultAdapterResolver, {
    goal: args.goal,
    plan: !args.noPlan,
    onLine: (agentId, line) => console.log(`  [${agentId}] ${line}`),
  });

  const cleanup = async () => {
    await run.stop();
  };
  process.on("SIGINT", () => {
    console.log("\nStopping agents (session left intact — resume with `duo start` state or `duo resume`).");
    void cleanup().then(() => process.exit(0));
  });

  try {
    await run.start();
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    await cleanup();
    process.exit(1);
  }

  console.log("\n✓ All agents registered.");
  if (!args.noPlan) {
    console.log("  Agents are planning. Review with `duo plan`, then `duo approve`.");
  } else {
    console.log("  Executing preset board (no planning phase).");
  }

  // Live status refresh until done.
  const unsub = await client.subscribe(async () => {
    const status = await client.status();
    process.stdout.write("\x1b[2J\x1b[H"); // clear
    console.log(renderStatus(status as never));
  });

  await run.waitUntilDone();
  unsub();
  await run.stop();

  const final = await client.status();
  console.log("\n" + renderStatus(final as never));
  console.log("\n✓ Session complete. `duo stop` to archive and shut down the hub.");
}

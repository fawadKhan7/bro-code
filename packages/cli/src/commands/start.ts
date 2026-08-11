/** `duo start "<goal>"` — thin client of the hub. The HUB now owns agent processes (phase 6),
 *  so this command just ensures the hub is up, POSTs the session, and watches until done.
 *  Killing this terminal no longer kills the session — agents keep running in the hub daemon.
 */
import { HubClient } from "../hubClient.js";
import { ensureHub } from "../hubProcess.js";
import { requireConfig } from "../context.js";
import { renderStatus } from "../render.js";

export interface StartArgs {
  goal: string;
  noPlan: boolean;
  mode?: "auto-run" | "checkpoint" | "ask";
}

export async function cmdStart(args: StartArgs): Promise<void> {
  const config = requireConfig();
  console.log(`Starting session: "${args.goal}"`);
  const hub = await ensureHub(config.port);
  console.log(`  Hub ${hub.spawned ? "started" : "reused"} on ${hub.url}`);
  const client = new HubClient(hub.url);

  const existing = (await client.status()) as { active?: boolean };
  if (existing.active) {
    console.error("✗ A session is already active. Run `duo stop` first, or `duo status` to see it.");
    process.exit(1);
  }

  const res = (await client.startSession({ goal: args.goal, plan: !args.noPlan, mode: args.mode })) as {
    ok?: boolean;
    error?: string;
  };
  if (res.ok !== true) {
    console.error(`✗ ${res.error ?? "could not start session"}`);
    process.exit(1);
  }

  console.log(!args.noPlan ? "  Agents launching & planning…" : "  Agents launching (no plan phase)…");

  // Watch: surface a launch failure loudly, then live status until done.
  let registeredAnnounced = false;
  const unsub = await client.subscribe(async () => {
    const status = (await client.status()) as {
      phase?: string;
      launchError?: string | null;
      allRegistered?: boolean;
    };
    if (status.launchError) {
      console.error(`\n✗ ${status.launchError}`);
      unsub();
      process.exit(1);
    }
    if (status.allRegistered && !registeredAnnounced) {
      registeredAnnounced = true;
      console.log("✓ All agents registered.");
      if (!args.noPlan) console.log("  Review the plan with `duo plan`, then `duo approve`.");
    }
    process.stdout.write("\x1b[2J\x1b[H");
    console.log(renderStatus(status as never));
    if (status.phase === "done") {
      unsub();
      console.log("\n✓ Session complete. `duo stop` to archive and shut down the hub.");
      process.exit(0);
    }
  });

  // This terminal only observes now; Ctrl-C detaches (agents keep running in the hub).
  process.on("SIGINT", () => {
    console.log("\nDetaching (agents keep running in the hub). `duo status` to reattach, `duo stop` to end.");
    unsub();
    process.exit(0);
  });
}

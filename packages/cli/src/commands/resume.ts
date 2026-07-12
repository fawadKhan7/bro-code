/** `duo resume <agent>` — ask the hub to relaunch one agent, then watch. The hub owns the
 *  process now (phase 6), so this is a thin REST call plus a live status view.
 */
import { requireHub } from "../context.js";
import { renderStatus } from "../render.js";

export async function cmdResume(agentId: string): Promise<void> {
  const { config, hub } = await requireHub();
  if (!config.agents.some((a) => a.id === agentId)) {
    console.error(`✗ No agent "${agentId}" in config. Agents: ${config.agents.map((a) => a.id).join(", ")}`);
    process.exit(1);
  }

  const status = (await hub.status()) as { active?: boolean };
  if (!status.active) {
    console.error("✗ No active session to resume into.");
    process.exit(1);
  }

  console.log(`Resuming Agent ${agentId}…`);
  const res = (await hub.resumeAgent(agentId)) as { ok?: boolean; error?: string };
  if (res.ok !== true) {
    console.error(`✗ ${res.error ?? "resume failed"}`);
    process.exit(1);
  }
  console.log("✓ Relaunched. Watching…");

  const unsub = await hub.subscribe(async () => {
    const s = (await hub.status()) as { phase?: string };
    process.stdout.write("\x1b[2J\x1b[H");
    console.log(renderStatus(s as never));
    if (s.phase === "done") {
      unsub();
      console.log("\n✓ Session complete.");
      process.exit(0);
    }
  });
  process.on("SIGINT", () => {
    unsub();
    process.exit(0);
  });
}

/** `duo resume <agent>` — relaunch one crashed/stopped agent with a resume kickoff and watch it.
 *  Used when `duo start` isn't running (e.g. after Ctrl-C); `duo start` auto-resumes otherwise.
 */
import { getAdapter } from "@duo/adapters";
import { requireHub } from "../context.js";
import { assembleResumeKickoff, TOOL_PREFIX } from "../kickoffAssembly.js";
import { renderStatus } from "../render.js";

export async function cmdResume(agentId: string): Promise<void> {
  const { config, hub, url } = await requireHub();
  const agent = config.agents.find((a) => a.id === agentId);
  if (!agent) {
    console.error(`✗ No agent "${agentId}" in config. Agents: ${config.agents.map((a) => a.id).join(", ")}`);
    process.exit(1);
  }

  const status = (await hub.status()) as { active?: boolean; goal?: string };
  if (!status.active) {
    console.error("✗ No active session to resume into.");
    process.exit(1);
  }

  console.log(`Resuming Agent ${agentId}…`);
  await hub.releaseAgent(agentId); // reopen any claims the dead process held

  const adapter = getAdapter(agent.runner);
  const kickoff = assembleResumeKickoff(config, agent, status.goal ?? "");
  const ctx = {
    agent,
    kickoffPrompt: kickoff,
    hubUrl: url,
    toolPrefix: TOOL_PREFIX,
    runnerOptions: { claudePermissionMode: config.claudePermissionMode },
  };
  await adapter.configure(ctx);
  const handle = await adapter.launch(ctx);
  handle.events.on("output", (line: string) => console.log(`  [${agentId}] · ${line}`));
  handle.events.on("exit", (info: { code: number | null }) =>
    console.log(`  [${agentId}] [process exited code=${info.code ?? "?"}]`)
  );

  const stop = async () => {
    await handle.stop();
  };
  process.on("SIGINT", () => void stop().then(() => process.exit(0)));

  let done = false;
  const unsub = await hub.subscribe(async (event) => {
    if (event.type === "phase" && (event.data as { phase?: string }).phase === "done") done = true;
    const s = await hub.status();
    process.stdout.write("\x1b[2J\x1b[H");
    console.log(renderStatus(s as never));
    if (done) {
      unsub();
      await stop();
      console.log("\n✓ Session complete.");
      process.exit(0);
    }
  });
}

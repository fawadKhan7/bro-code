/** Shared command helpers: load config, build a hub client, fail with a clear message. */
import { loadConfig, type DuoConfig } from "@duo/shared";
import { HubClient } from "./hubClient.js";
import { hubReachable } from "./hubProcess.js";

export function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

export function requireConfig(): DuoConfig {
  const config = loadConfig();
  if (!config || config.agents.length === 0) {
    fail("No configuration found. Run `duo init` first.");
  }
  return config;
}

/** Config + a hub client, requiring the hub to be reachable (for control commands). */
export async function requireHub(): Promise<{ config: DuoConfig; hub: HubClient; url: string }> {
  const config = requireConfig();
  if (!(await hubReachable(config.port))) {
    fail(`No hub running on port ${config.port}. Start a session with \`duo start "<goal>"\` first.`);
  }
  const url = `http://127.0.0.1:${config.port}`;
  return { config, hub: new HubClient(url), url };
}

/** Shared test harness: a hub that owns scripted agents, driven over REST. Zero AI tokens. */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Hub } from "@duo/hub";
import { saveConfig, type DuoConfig, type Runner } from "@duo/shared";
import { HubClient } from "../src/hubClient.js";
import type { ScriptedAdapter, ScriptClient } from "./scriptedAgent.js";

export interface BootedHub {
  hub: Hub;
  client: HubClient;
  home: string;
}

export async function bootHub(
  adapter: ScriptedAdapter,
  opts?: { mode?: "auto-run" | "checkpoint"; runnerA?: Runner; runnerB?: Runner }
): Promise<BootedHub> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "duo-cli-"));
  process.env.DUO_HOME = home;
  process.env.DUO_LONGPOLL_MS = "800";
  const wsA = path.join(home, "web");
  const wsB = path.join(home, "api");
  fs.mkdirSync(wsA, { recursive: true });
  fs.mkdirSync(wsB, { recursive: true });
  const config: DuoConfig = {
    agents: [
      { id: "A", workspace: wsA, runner: opts?.runnerA ?? "fake", role: "Frontend" },
      { id: "B", workspace: wsB, runner: opts?.runnerB ?? "fake", role: "Backend" },
    ],
    preset: "frontend-backend",
    mode: opts?.mode ?? "auto-run",
    port: 0,
    claudePermissionMode: "acceptEdits",
  };
  saveConfig(config);
  const hub = new Hub({ port: 0, persistFile: path.join(home, "s.json"), restore: false, adapterResolver: () => adapter });
  await hub.start();
  return { hub, client: new HubClient(hub.url), home };
}

export async function teardown(booted: BootedHub | undefined): Promise<void> {
  if (!booted) return;
  await booted.hub.stop();
  fs.rmSync(booted.home, { recursive: true, force: true });
}

export async function waitForPhase(client: HubClient, phase: string, ms = 6000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const s = (await client.status()) as { phase?: string; launchError?: string | null };
    if (s.launchError) throw new Error("launchError: " + s.launchError);
    if (s.phase === phase) return;
    if (Date.now() - start > ms) throw new Error(`timeout waiting for phase ${phase} (got ${s.phase})`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

export async function waitForAllRegistered(client: HubClient, ms = 6000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const s = (await client.status()) as { allRegistered?: boolean; launchError?: string | null };
    if (s.launchError) throw new Error("launchError: " + s.launchError);
    if (s.allRegistered) return;
    if (Date.now() - start > ms) throw new Error("timeout waiting for registration");
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** Wait until the merged proposed board has at least `count` items (both agents posted). */
export async function waitForProposal(client: HubClient, count: number, ms = 6000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const b = (await client.board()) as { proposedBoard?: unknown[] };
    if ((b.proposedBoard?.length ?? 0) >= count) return;
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${count} proposed items`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

export async function finishOwned(c: ScriptClient): Promise<void> {
  const board = (await c.getBoard()) as { items: Array<{ id: string; owner: string }> };
  for (const item of board.items.filter((i) => i.owner === c.id)) {
    await c.claim(item.id);
    await c.complete(item.id, [`${item.id}.ts`]);
  }
}

/** CLI orchestration end-to-end via SessionRun + scripted agents against a real in-process hub.
 *  Covers: register gate, plan→approve→execute→done, --no-plan, and crash auto-resume.
 *  Zero AI tokens.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Hub } from "@duo/hub";
import type { DuoConfig } from "@duo/shared";
import { HubClient } from "../src/hubClient.js";
import { SessionRun } from "../src/sessionRunner.js";
import { ScriptedAdapter, type AgentScript, type ScriptClient } from "./scriptedAgent.js";

let hub: Hub;
let home: string;

afterEach(async () => {
  await hub?.stop();
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

async function makeConfig(): Promise<{ config: DuoConfig; wsA: string; wsB: string }> {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "duo-cli-"));
  process.env.DUO_HOME = home;
  process.env.DUO_LONGPOLL_MS = "800";
  const wsA = path.join(home, "web");
  const wsB = path.join(home, "api");
  fs.mkdirSync(wsA, { recursive: true });
  fs.mkdirSync(wsB, { recursive: true });
  const config: DuoConfig = {
    agents: [
      { id: "A", workspace: wsA, runner: "fake", role: "Frontend" },
      { id: "B", workspace: wsB, runner: "fake", role: "Backend" },
    ],
    preset: "frontend-backend",
    mode: "auto-run",
    port: 0,
    claudePermissionMode: "acceptEdits",
  };
  return { config, wsA, wsB };
}

async function startHub(persistFile: string): Promise<{ client: HubClient; url: string }> {
  hub = new Hub({ port: 0, persistFile, restore: false });
  await hub.start();
  return { client: new HubClient(hub.url), url: hub.url };
}

/** Claim and complete every item this agent owns. */
async function finishOwnedItems(client: ScriptClient): Promise<void> {
  const board = (await client.getBoard()) as { items: Array<{ id: string; owner: string }> };
  for (const item of board.items.filter((i) => i.owner === client.id)) {
    await client.claim(item.id);
    await client.complete(item.id, [`${item.id}.ts`]);
  }
}

describe("SessionRun orchestration (scripted agents)", () => {
  it("runs plan → approve → execute → done, same processes throughout", async () => {
    const { config } = await makeConfig();
    const { client, url } = await startHub(path.join(home, "s.json"));

    const scriptA: AgentScript = async (c) => {
      await c.register();
      await c.postPlan([{ title: "Login UI", ownerHint: "A", paths: ["web/"] }]);
      await c.awaitApproval();
      await finishOwnedItems(c);
    };
    const scriptB: AgentScript = async (c) => {
      await c.register();
      await c.postPlan([
        { title: "Auth API", ownerHint: "B", paths: ["api/"] },
        { title: "Deploy secrets", ownerHint: null, paths: ["infra/"] },
      ]);
      await c.awaitApproval();
      await c.postContract("service: auth-api\nPOST /auth/login → { token }");
      await finishOwnedItems(c);
    };

    const adapter = new ScriptedAdapter({ scripts: { A: scriptA, B: scriptB } });
    const run = new SessionRun(config, client, url, () => adapter, {
      goal: "Add auth",
      plan: true,
      registrationTimeoutMs: 5000,
    });

    await run.start();

    // Registration gate passed; planning phase, plan merged with one unassigned item.
    let status = (await client.status()) as { phase: string; agents: Array<{ registered: boolean }> };
    expect(status.phase).toBe("planning");
    expect(status.agents.every((a) => a.registered)).toBe(true);
    expect(adapter.configureCalls.length).toBe(2);

    const board = (await client.board()) as { plan: { unassigned: string[] } };
    expect(board.plan.unassigned).toHaveLength(1);

    // Human approves, assigning the unassigned item to B.
    const approve = await client.approvePlan({ assign: { [board.plan.unassigned[0]]: "B" } });
    expect(approve.ok).toBe(true);

    await run.waitUntilDone();
    status = (await client.status()) as { phase: string; agents: Array<{ registered: boolean }> };
    expect(status.phase).toBe("done");
    await run.stop();
  });

  it("--no-plan executes the preset board without a planning phase", async () => {
    const { config } = await makeConfig();
    const { client, url } = await startHub(path.join(home, "s.json"));

    const script: AgentScript = async (c) => {
      await c.register();
      await finishOwnedItems(c);
    };
    const adapter = new ScriptedAdapter({ scripts: { A: script, B: script } });
    const run = new SessionRun(config, client, url, () => adapter, {
      goal: "Fix typo",
      plan: false,
      registrationTimeoutMs: 5000,
    });

    await run.start();
    // No planning phase: goes straight to executing (may already be done — agents are instant).
    const status = (await client.status()) as { phase: string; proposedItems: number };
    expect(["executing", "done"]).toContain(status.phase);
    expect(status.proposedItems).toBe(0); // board was preset-filled, never proposed
    await run.waitUntilDone();
    expect(((await client.status()) as { phase: string }).phase).toBe("done");
    await run.stop();
  });

  it("fails loudly if an agent never registers", async () => {
    const { config } = await makeConfig();
    const { client, url } = await startHub(path.join(home, "s.json"));

    const goodScript: AgentScript = async (c) => {
      await c.register();
      await finishOwnedItems(c);
    };
    const silentScript: AgentScript = async () => {
      // never registers, never returns until stopped
      await new Promise((r) => setTimeout(r, 10_000));
    };
    const adapter = new ScriptedAdapter({ scripts: { A: goodScript, B: silentScript } });
    const run = new SessionRun(config, client, url, () => adapter, {
      goal: "goal",
      plan: false,
      registrationTimeoutMs: 1000,
    });

    await expect(run.start()).rejects.toThrow(/did not register/);
    await run.stop();
  });

  it("auto-resumes a crashed agent from its resume brief", async () => {
    const { config } = await makeConfig();
    const { client, url } = await startHub(path.join(home, "s.json"));

    // A crashes after claiming (returns without completing) → premature exit → auto-resume.
    const crashOnce: AgentScript = async (c) => {
      await c.register();
      const board = (await c.getBoard()) as { items: Array<{ id: string; owner: string }> };
      const mine = board.items.find((i) => i.owner === "A")!;
      await c.claim(mine.id);
      return; // "crash" — item left claimed, not done
    };
    const resumeA: AgentScript = async (c) => {
      await c.register();
      const brief = (await c.resumeBrief()) as { brief: string };
      if (!brief.brief.includes("Add auth")) throw new Error("resume brief missing goal");
      await finishOwnedItems(c); // reopened item gets re-claimed and completed
    };
    const scriptB: AgentScript = async (c) => {
      await c.register();
      await finishOwnedItems(c);
    };

    const adapter = new ScriptedAdapter({
      scripts: { A: crashOnce, B: scriptB },
      resumeScripts: { A: resumeA },
    });
    const lines: string[] = [];
    const run = new SessionRun(config, client, url, () => adapter, {
      goal: "Add auth",
      plan: false,
      registrationTimeoutMs: 5000,
      maxResumes: 2,
      onLine: (id, line) => lines.push(`${id}: ${line}`),
    });

    await run.start();
    await run.waitUntilDone();

    expect(((await client.status()) as { phase: string }).phase).toBe("done");
    expect(lines.some((l) => l.includes("resuming from brief"))).toBe(true);
    await run.stop();
  });
});

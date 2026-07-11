/** Mixed-session orchestration (tokenless): the runner label must not change orchestration —
 *  cursor-cli↔claude-code drives identically to claude↔claude. Also validates the manual-slot
 *  (cursor-ide) registration-gate extension: a slow-to-register human paste still passes the gate.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Hub } from "@duo/hub";
import type { DuoConfig, Runner } from "@duo/shared";
import { HubClient } from "../src/hubClient.js";
import { SessionRun } from "../src/sessionRunner.js";
import { ScriptedAdapter, type AgentScript, type ScriptClient } from "./scriptedAgent.js";

let hub: Hub;
let home: string;

afterEach(async () => {
  await hub?.stop();
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

function config(runnerA: Runner, runnerB: Runner): DuoConfig {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "duo-mixed-"));
  process.env.DUO_HOME = home;
  process.env.DUO_LONGPOLL_MS = "800";
  const wsA = path.join(home, "web");
  const wsB = path.join(home, "api");
  fs.mkdirSync(wsA, { recursive: true });
  fs.mkdirSync(wsB, { recursive: true });
  return {
    agents: [
      { id: "A", workspace: wsA, runner: runnerA, role: "Frontend" },
      { id: "B", workspace: wsB, runner: runnerB, role: "Backend" },
    ],
    preset: "frontend-backend",
    mode: "auto-run",
    port: 0,
    claudePermissionMode: "acceptEdits",
  };
}

async function startHub(): Promise<{ client: HubClient; url: string }> {
  hub = new Hub({ port: 0, persistFile: path.join(home, "s.json"), restore: false });
  await hub.start();
  return { client: new HubClient(hub.url), url: hub.url };
}

async function finishOwned(c: ScriptClient): Promise<void> {
  const board = (await c.getBoard()) as { items: Array<{ id: string; owner: string }> };
  for (const item of board.items.filter((i) => i.owner === c.id)) {
    await c.claim(item.id);
    await c.complete(item.id, [`${item.id}.ts`]);
  }
}

const noPlanScript: AgentScript = async (c) => {
  await c.register();
  await finishOwned(c);
};

describe("mixed sessions (runner-agnostic orchestration)", () => {
  it("cursor-cli (A) ↔ claude-code (B) completes identically", async () => {
    const cfg = config("cursor-cli", "claude-code");
    const { client, url } = await startHub();
    const adapter = new ScriptedAdapter({ scripts: { A: noPlanScript, B: noPlanScript } });
    const run = new SessionRun(cfg, client, url, () => adapter, {
      goal: "Add auth",
      plan: false,
      registrationTimeoutMs: 5000,
    });
    await run.start();
    await run.waitUntilDone();
    expect(((await client.status()) as { phase: string }).phase).toBe("done");
    await run.stop();
  });

  it("claude-code (A) ↔ cursor-cli (B) with a full plan→approve cycle", async () => {
    const cfg = config("claude-code", "cursor-cli");
    const { client, url } = await startHub();
    const scriptA: AgentScript = async (c) => {
      await c.register();
      await c.postPlan([{ title: "UI", ownerHint: "A", paths: ["web/"] }]);
      await c.awaitApproval();
      await finishOwned(c);
    };
    const scriptB: AgentScript = async (c) => {
      await c.register();
      await c.postPlan([{ title: "API", ownerHint: "B", paths: ["api/"] }]);
      await c.awaitApproval();
      await finishOwned(c);
    };
    const adapter = new ScriptedAdapter({ scripts: { A: scriptA, B: scriptB } });
    const run = new SessionRun(cfg, client, url, () => adapter, {
      goal: "Add auth",
      plan: true,
      registrationTimeoutMs: 5000,
      autoApproveTrivial: false,
    });
    await run.start();
    expect(((await client.status()) as { phase: string }).phase).toBe("planning");
    await client.approvePlan({});
    await run.waitUntilDone();
    expect(((await client.status()) as { phase: string }).phase).toBe("done");
    await run.stop();
  });

  it("manual slot (cursor-ide) with slow paste still passes the registration gate", async () => {
    const cfg = config("cursor-ide", "claude-code");
    const { client, url } = await startHub();
    // Agent A "pastes" (registers) only after 500ms — longer than the base 200ms timeout.
    const slowManual: AgentScript = async (c) => {
      await new Promise((r) => setTimeout(r, 500));
      await c.register();
      await finishOwned(c);
    };
    const adapter = new ScriptedAdapter({
      scripts: { A: slowManual, B: noPlanScript },
      manualAgents: ["A"], // handle.kind === "manual" → gate extends to 300s
    });
    const run = new SessionRun(cfg, client, url, () => adapter, {
      goal: "Add auth",
      plan: false,
      registrationTimeoutMs: 200, // deliberately shorter than A's paste delay
    });
    // Would throw "did not register" without the manual-slot extension.
    await run.start();
    await run.waitUntilDone();
    expect(((await client.status()) as { phase: string }).phase).toBe("done");
    await run.stop();
  });
});

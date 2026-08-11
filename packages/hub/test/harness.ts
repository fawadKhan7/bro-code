/** Test harness: real hub on an ephemeral port, temp DUO_HOME, temp workspaces,
 *  a REST "human" client, and fake-agent factories. Zero AI tokens anywhere.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AgentConfig, Mode, PlanItemInput } from "@duo/shared";
import { Hub } from "../src/server.js";
import { FakeAgent } from "./fakeAgent.js";

export interface Harness {
  hub: Hub;
  url: string;
  home: string;
  persistFile: string;
  wsA: string;
  wsB: string;
  agents: AgentConfig[];
  human: Human;
  createSession(goal: string, opts?: SessionOpts): Promise<Record<string, unknown>>;
  connectAgent(id: string): Promise<FakeAgent>;
  /** Restart the hub against the same persist file (crash simulation). */
  restartHub(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface SessionOpts {
  mode?: Mode;
  plan?: boolean;
  presetBoard?: PlanItemInput[];
  autoApproveTrivial?: boolean;
  agents?: AgentConfig[];
}

export class Human {
  constructor(private getUrl: () => string) {}

  private async post(pathname: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.getUrl()}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return (await res.json()) as Record<string, unknown>;
  }

  private async get(pathname: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.getUrl()}${pathname}`);
    return (await res.json()) as Record<string, unknown>;
  }

  health() {
    return this.get("/health");
  }
  status() {
    return this.get("/api/status");
  }
  board() {
    return this.get("/api/board");
  }
  createSession(body: unknown) {
    return this.post("/api/session", body);
  }
  approvePlan(edits: unknown = {}) {
    return this.post("/api/plan/approve", edits);
  }
  planFeedback(message: string) {
    return this.post("/api/plan/feedback", { message });
  }
  resolveCheckpoint(agentId: string, approved: boolean, feedback?: string) {
    return this.post("/api/checkpoint/resolve", { agent_id: agentId, approved, feedback });
  }
  markOutOfScope(taskIds: string[]) {
    return this.post("/api/board/out-of-scope", { task_ids: taskIds });
  }
  releaseAgent(agentId: string) {
    return this.post("/api/agent/release", { agent_id: agentId });
  }
  sendChat(text: string, to?: string) {
    return this.post("/api/chat", { text, to });
  }
  setMode(mode: string) {
    return this.post("/api/mode", { mode });
  }
  getChat(sinceId?: number) {
    return this.get(`/api/chat${sinceId ? `?since_id=${sinceId}` : ""}`);
  }
  stop() {
    return this.post("/api/stop", {});
  }
}

export async function startHarness(opts?: { longPollMs?: number }): Promise<Harness> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "duo-test-"));
  process.env.DUO_HOME = home;
  process.env.DUO_LONGPOLL_MS = String(opts?.longPollMs ?? 1500);

  const wsA = path.join(home, "workspace-a");
  const wsB = path.join(home, "workspace-b");
  fs.mkdirSync(wsA, { recursive: true });
  fs.mkdirSync(wsB, { recursive: true });

  const persistFile = path.join(home, "session.json");
  let hub = new Hub({ port: 0, persistFile, restore: false });
  await hub.start();

  const agents: AgentConfig[] = [
    { id: "A", workspace: wsA, runner: "fake", role: "Frontend" },
    { id: "B", workspace: wsB, runner: "fake", role: "Backend" },
  ];

  const openAgents: FakeAgent[] = [];
  const human = new Human(() => hub.url);

  const harness: Harness = {
    hub,
    get url() {
      return hub.url;
    },
    home,
    persistFile,
    wsA,
    wsB,
    agents,
    human,

    async createSession(goal, sessionOpts = {}) {
      return human.createSession({
        goal,
        agents: sessionOpts.agents ?? agents,
        mode: sessionOpts.mode ?? "auto-run",
        plan: sessionOpts.plan,
        presetBoard: sessionOpts.presetBoard,
        // Most tests use >2-item plans; disable the fast path unless a test opts in.
        autoApproveTrivial: sessionOpts.autoApproveTrivial ?? false,
      });
    },

    async connectAgent(id: string) {
      const cfg = (harness.agents.find((a) => a.id === id) ?? agents.find((a) => a.id === id))!;
      const agent = await FakeAgent.connect(hub.url, { id, workspace: cfg.workspace });
      openAgents.push(agent);
      return agent;
    },

    async restartHub() {
      await hub.stop();
      hub = new Hub({ port: 0, persistFile, restore: true });
      await hub.start();
      harness.hub = hub;
    },

    async cleanup() {
      for (const a of openAgents) {
        try {
          await a.close();
        } catch {
          /* ignore */
        }
      }
      await hub.stop();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };

  return harness;
}

/** Standard 5-item OAuth-style plan split across two agents, with one unassigned item. */
export const OAUTH_PLAN = {
  fromA: [
    { title: "Google OAuth consent screen + login button", ownerHint: "A", paths: ["src/pages/login/"] },
    { title: "Store session token in httpOnly cookie flow", ownerHint: "A", paths: ["src/lib/auth.ts"] },
  ] as PlanItemInput[],
  fromB: [
    { title: "/auth/google + callback route, token issuance", ownerHint: "B", paths: ["src/auth/"] },
    { title: "users.google_id migration", ownerHint: "B", paths: ["migrations/"] },
    { title: "Update deploy config with new secrets", ownerHint: null, paths: ["infra/"] },
  ] as PlanItemInput[],
};

/** SessionSupervisor — owns the agent processes (moved from the CLI in phase 6).
 *  Runs INSIDE the hub, so it drives the SessionStore directly (no HTTP): create session, launch
 *  agents via adapters, keep them alive across planning→execution, pipe output into hub logs,
 *  gate on registration, auto-resume crashes. This is what lets any client (CLI, browser, app)
 *  start a session over REST. See docs/05-implementation-plan/phase-06-hub-owned-sessions.md.
 */
import { getAdapter, type AgentAdapter, type AgentHandle, type LaunchContext } from "@duo/adapters";
import type { AgentConfig, DuoConfig, Runner } from "@duo/shared";
import type { SessionStore } from "./store.js";
import { assembleKickoff, assembleResumeKickoff, presetBoard, TOOL_PREFIX } from "./kickoff.js";

export type AdapterResolver = (runner: Runner) => AgentAdapter;

export function defaultAdapterResolver(runner: Runner): AgentAdapter {
  return getAdapter(runner);
}

export interface StartOptions {
  goal: string;
  plan: boolean;
  registrationTimeoutMs?: number;
  maxResumes?: number;
  autoApproveTrivial?: boolean;
}

interface LiveAgent {
  config: AgentConfig;
  adapter: AgentAdapter;
  handle: AgentHandle;
  resumes: number;
}

export class SessionSupervisor {
  private agents = new Map<string, LiveAgent>();
  private stopping = false;
  private config: DuoConfig | null = null;
  private opts: StartOptions | null = null;

  constructor(
    private store: SessionStore,
    private resolveAdapter: AdapterResolver = defaultAdapterResolver
  ) {}

  isRunning(): boolean {
    return this.agents.size > 0;
  }

  private log(agentId: string, line: string): void {
    this.store.postUpdate(agentId, line);
  }

  /** Create session + launch agents. Registration gating runs in the background (see below). */
  async start(config: DuoConfig, hubUrl: string, opts: StartOptions): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.isRunning()) return { ok: false, error: "A session is already running." };
    this.config = config;
    this.opts = opts;
    this.stopping = false;

    const created = this.store.createSession({
      goal: opts.goal,
      agents: config.agents,
      mode: config.mode,
      plan: opts.plan,
      presetBoard: opts.plan ? undefined : presetBoard(config, opts.goal),
      autoApproveTrivial: opts.autoApproveTrivial ?? true,
    });
    if ("ok" in created && created.ok) {
      // proceed
    } else {
      return { ok: false, error: String((created as { error?: string }).error ?? "could not create session") };
    }

    this.hubUrl = hubUrl;
    this.store.setLaunchError(null);

    for (const agent of config.agents) {
      const adapter = this.resolveAdapter(agent.runner);
      const kickoff = assembleKickoff(config, agent, { goal: opts.goal, plan: opts.plan });
      const ctx = this.ctx(agent, kickoff);
      await adapter.configure(ctx);
      const handle = await adapter.launch(ctx);
      const live: LiveAgent = { config: agent, adapter, handle, resumes: 0 };
      this.agents.set(agent.id, live);
      this.wireHandle(live);
      this.log(agent.id, `launched (${agent.runner})`);
    }

    // Registration gate runs in the background so start() returns promptly (manual slots can take
    // minutes). Failure is surfaced via store.setLaunchError → status.launchError.
    void this.gateOnRegistration();
    return { ok: true };
  }

  private hubUrl = "http://127.0.0.1:3131";

  private ctx(agent: AgentConfig, kickoff: string): LaunchContext {
    return {
      agent,
      kickoffPrompt: kickoff,
      hubUrl: this.hubUrl,
      toolPrefix: TOOL_PREFIX,
      runnerOptions: { claudePermissionMode: this.config!.claudePermissionMode },
    };
  }

  private wireHandle(live: LiveAgent): void {
    live.handle.events.on("output", (line: string) => this.log(live.config.id, `· ${line}`));
    live.handle.events.on("usage", (tokens: number) => this.store.addTokens(live.config.id, tokens));
    live.handle.events.on("error", (err: Error) => this.log(live.config.id, `[error] ${err.message}`));
    live.handle.events.on("exit", (info: { code: number | null }) => {
      if (this.stopping || this.store.getState().phase === "done") return;
      this.log(live.config.id, `[process exited code=${info.code ?? "?"}]`);
      void this.handleExit(live);
    });
  }

  private async handleExit(live: LiveAgent): Promise<void> {
    const board = this.store.getState().board;
    const unfinished = board.filter(
      (i) =>
        (i.owner === live.config.id || i.claimedBy === live.config.id) &&
        i.status !== "done" &&
        i.status !== "out-of-scope"
    );
    if (unfinished.length === 0) {
      this.log(live.config.id, "finished its work and exited cleanly");
      return;
    }
    await this.resumeAfterCrash(live);
  }

  private async resumeAfterCrash(live: LiveAgent): Promise<void> {
    const max = this.opts?.maxResumes ?? 2;
    if (live.resumes >= max) {
      this.log(live.config.id, `crashed ${live.resumes} times — giving up auto-resume. Run \`duo resume ${live.config.id}\`.`);
      return;
    }
    live.resumes += 1;
    this.log(live.config.id, `crashed — releasing claims and resuming from brief (attempt ${live.resumes}/${max})`);
    this.store.releaseAgent(live.config.id);
    const kickoff = assembleResumeKickoff(this.config!, live.config, this.opts!.goal);
    const ctx = this.ctx(live.config, kickoff);
    await live.adapter.configure(ctx);
    live.handle = await live.adapter.launch(ctx);
    this.wireHandle(live);
  }

  private async gateOnRegistration(): Promise<void> {
    const hasManual = [...this.agents.values()].some((a) => a.handle.kind === "manual");
    const base = this.opts?.registrationTimeoutMs ?? 30_000;
    const timeout = hasManual ? Math.max(base, 300_000) : base;
    const deadline = Date.now() + timeout;
    for (;;) {
      if (this.stopping) return;
      const reg = this.store.registrationStatus();
      const missing = Object.entries(reg).filter(([, v]) => !v).map(([id]) => id);
      if (missing.length === 0) {
        this.log("system", "all agents registered");
        return;
      }
      if (Date.now() > deadline) {
        this.store.setLaunchError(
          `Agents did not register within ${Math.round(timeout / 1000)}s: ${missing.join(", ")}. ` +
            `MCP likely did not attach. For Cursor, try the cursor-ide runner.`
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** Manually relaunch one agent (duo resume). */
  async resume(agentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const live = this.agents.get(agentId);
    if (!live) {
      // Agent not tracked (e.g. hub restarted) — rebuild from config.
      const agent = this.config?.agents.find((a) => a.id === agentId);
      if (!agent || !this.config) return { ok: false, error: `No agent "${agentId}" to resume.` };
      const adapter = this.resolveAdapter(agent.runner);
      this.store.releaseAgent(agentId);
      const kickoff = assembleResumeKickoff(this.config, agent, this.store.getState().goal);
      const ctx = this.ctx(agent, kickoff);
      await adapter.configure(ctx);
      const handle = await adapter.launch(ctx);
      const rebuilt: LiveAgent = { config: agent, adapter, handle, resumes: 0 };
      this.agents.set(agentId, rebuilt);
      this.wireHandle(rebuilt);
      return { ok: true };
    }
    await this.resumeAfterCrash(live);
    return { ok: true };
  }

  /** Stop all agent processes (session state left to the caller / store.stopSession). */
  async stopAgents(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.agents.values()].map((a) => a.handle.stop().catch(() => undefined)));
    this.agents.clear();
  }
}

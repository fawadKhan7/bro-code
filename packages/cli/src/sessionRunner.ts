/** Orchestration: create the session, launch agents through adapters, keep them alive across
 *  planning→execution, pipe output to hub logs, gate on registration, auto-resume crashes,
 *  and resolve when the session reaches `done`.
 *
 *  The adapter resolver is injectable so tests drive the whole path with fake agents (no tokens).
 */
import { getAdapter, type AgentAdapter, type AgentHandle, type LaunchContext } from "@duo/adapters";
import type { AgentConfig, DuoConfig, HubEvent, Runner } from "@duo/shared";
import { HubClient } from "./hubClient.js";
import { assembleKickoff, assembleResumeKickoff, presetBoard, TOOL_PREFIX } from "./kickoffAssembly.js";

export type AdapterResolver = (runner: Runner) => AgentAdapter;

export interface RunOptions {
  goal: string;
  plan: boolean;
  /** Seconds to wait for every agent to call register_agent before failing loudly. */
  registrationTimeoutMs?: number;
  /** Max automatic resume attempts per agent on premature exit. */
  maxResumes?: number;
  /** Auto-approve trivial plans (≤2 owned items). Default true. */
  autoApproveTrivial?: boolean;
  /** Called with (agentId, line) for every piped output/status line — CLI prints these. */
  onLine?: (agentId: string, line: string) => void;
}

interface LiveAgent {
  config: AgentConfig;
  adapter: AgentAdapter;
  handle: AgentHandle;
  resumes: number;
}

export class SessionRun {
  private agents = new Map<string, LiveAgent>();
  private unsubscribe: (() => void) | null = null;
  private phase = "init";
  private donePromise: Promise<void>;
  private resolveDone!: () => void;
  private stopping = false;

  constructor(
    private config: DuoConfig,
    private hub: HubClient,
    private hubUrl: string,
    private resolveAdapter: AdapterResolver,
    private opts: RunOptions
  ) {
    this.donePromise = new Promise((r) => (this.resolveDone = r));
  }

  private emit(agentId: string, line: string): void {
    this.opts.onLine?.(agentId, line);
    void this.hub.log(agentId, line).catch(() => undefined);
  }

  private launchContext(agent: AgentConfig, kickoff: string): LaunchContext {
    return {
      agent,
      kickoffPrompt: kickoff,
      hubUrl: this.hubUrl,
      toolPrefix: TOOL_PREFIX,
      runnerOptions: { claudePermissionMode: this.config.claudePermissionMode },
    };
  }

  private wireHandle(live: LiveAgent): void {
    live.handle.events.on("output", (line: string) => this.emit(live.config.id, `· ${line}`));
    live.handle.events.on("error", (err: Error) => this.emit(live.config.id, `[error] ${err.message}`));
    live.handle.events.on("exit", (info: { code: number | null }) => {
      if (this.stopping || this.phase === "done") return;
      this.emit(live.config.id, `[process exited code=${info.code ?? "?"}]`);
      void this.handleExit(live);
    });
  }

  /** Distinguish a clean finish (no unfinished owned items) from a crash (work still owned). */
  private async handleExit(live: LiveAgent): Promise<void> {
    const board = (await this.hub.board().catch(() => ({ items: [] }))) as {
      items?: Array<{ owner: string | null; claimedBy: string | null; status: string }>;
    };
    const unfinished = (board.items ?? []).filter(
      (i) =>
        (i.owner === live.config.id || i.claimedBy === live.config.id) &&
        i.status !== "done" &&
        i.status !== "out-of-scope"
    );
    if (unfinished.length === 0) {
      this.emit(live.config.id, "finished its work and exited cleanly");
      return;
    }
    await this.resumeAfterCrash(live);
  }

  private async resumeAfterCrash(live: LiveAgent): Promise<void> {
    const max = this.opts.maxResumes ?? 2;
    if (live.resumes >= max) {
      this.emit(live.config.id, `crashed ${live.resumes} times — giving up auto-resume. Run \`duo resume ${live.config.id}\` manually.`);
      return;
    }
    live.resumes += 1;
    this.emit(live.config.id, `crashed — releasing claims and resuming from brief (attempt ${live.resumes}/${max})`);
    await this.hub.releaseAgent(live.config.id).catch(() => undefined);

    const kickoff = assembleResumeKickoff(this.config, live.config, this.opts.goal);
    await live.adapter.configure(this.launchContext(live.config, kickoff));
    const handle = await live.adapter.launch(this.launchContext(live.config, kickoff));
    live.handle = handle;
    this.wireHandle(live);
  }

  /** Create the session, launch every agent, gate on registration. Throws on failure (loud). */
  async start(): Promise<void> {
    const createResult = await this.hub.createSession({
      goal: this.opts.goal,
      agents: this.config.agents,
      mode: this.config.mode,
      plan: this.opts.plan,
      presetBoard: this.opts.plan ? undefined : presetBoard(this.config, this.opts.goal),
      autoApproveTrivial: this.opts.autoApproveTrivial ?? true,
    });
    if (createResult.ok !== true) {
      throw new Error(`Could not create session: ${String(createResult.error ?? "unknown")}`);
    }

    this.unsubscribe = await this.hub.subscribe((event) => this.onEvent(event));

    for (const agent of this.config.agents) {
      const adapter = this.resolveAdapter(agent.runner);
      const kickoff = assembleKickoff(this.config, agent, { goal: this.opts.goal, plan: this.opts.plan });
      const ctx = this.launchContext(agent, kickoff);
      await adapter.configure(ctx);
      const handle = await adapter.launch(ctx);
      const live: LiveAgent = { config: agent, adapter, handle, resumes: 0 };
      this.agents.set(agent.id, live);
      this.wireHandle(live);
      this.emit(agent.id, `launched (${agent.runner})`);
    }

    await this.gateOnRegistration();
  }

  private async gateOnRegistration(): Promise<void> {
    // Manual slots (cursor-ide) need time for a human to paste — extend the deadline generously.
    const hasManual = [...this.agents.values()].some((a) => a.handle.kind === "manual");
    const base = this.opts.registrationTimeoutMs ?? 30_000;
    const timeout = hasManual ? Math.max(base, 300_000) : base;
    const deadline = Date.now() + timeout;
    for (;;) {
      const status = (await this.hub.status()) as {
        agents?: Array<{ id: string; registered: boolean }>;
      };
      const agents = status.agents ?? [];
      const missing = agents.filter((a) => !a.registered).map((a) => a.id);
      if (missing.length === 0) return;
      if (Date.now() > deadline) {
        throw new Error(
          `Agents did not register within ${Math.round(timeout / 1000)}s: ${missing.join(", ")}. ` +
            `MCP likely did not attach. Check the agent output above; for Cursor try the cursor-ide runner (phase 3).`
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private onEvent(event: HubEvent): void {
    if (event.type === "phase") {
      const phase = (event.data as { phase?: string }).phase;
      if (phase) {
        this.phase = phase;
        if (phase === "done") this.resolveDone();
      }
    }
  }

  waitUntilDone(): Promise<void> {
    return this.donePromise;
  }

  getPhase(): string {
    return this.phase;
  }

  /** Stop agent processes. Leaves the hub session intact (resumable) unless the caller stops it. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.unsubscribe?.();
    await Promise.all([...this.agents.values()].map((a) => a.handle.stop().catch(() => undefined)));
  }
}

export function defaultAdapterResolver(runner: Runner): AgentAdapter {
  return getAdapter(runner);
}

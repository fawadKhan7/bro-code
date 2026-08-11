/** SessionSupervisor — owns the agent processes (moved from the CLI in phase 6).
 *  Runs INSIDE the hub, so it drives the SessionStore directly (no HTTP): create session, launch
 *  agents via adapters, keep them alive across planning→execution, pipe output into hub logs,
 *  gate on registration, auto-resume crashes. This is what lets any client (CLI, browser, app)
 *  start a session over REST. See docs/05-implementation-plan/phase-06-hub-owned-sessions.md.
 */
import { getAdapter, type AgentAdapter, type AgentHandle, type LaunchContext } from "@duo/adapters";
import type { AgentConfig, ChatMessage, DuoConfig, Runner } from "@duo/shared";
import type { SessionStore } from "./store.js";
import { assembleChatFollowUp, assembleKickoff, assembleResumeKickoff, presetBoard, TOOL_PREFIX } from "./kickoff.js";

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
  /** Runner session id from the last run ("session" handle event) — lets a chat wake resume the
   *  same AI session so the agent remembers its earlier work. */
  sessionRef?: string;
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
      this.store.setAgentActivity(agent.id, "starting", "launching");
      this.log(agent.id, `launched (${agent.runner})`);
    }

    // Registration gate runs in the background so start() returns promptly (manual slots can take
    // minutes). Failure is surfaced via store.setLaunchError → status.launchError.
    void this.gateOnRegistration();
    return { ok: true };
  }

  private hubUrl = "http://127.0.0.1:3131";

  private ctx(agent: AgentConfig, kickoff: string, resumeSessionRef?: string): LaunchContext {
    return {
      agent,
      kickoffPrompt: kickoff,
      hubUrl: this.hubUrl,
      toolPrefix: TOOL_PREFIX,
      runnerOptions: { claudePermissionMode: this.config!.claudePermissionMode },
      resumeSessionRef,
    };
  }

  private wireHandle(live: LiveAgent): void {
    live.handle.events.on("output", (line: string) => this.log(live.config.id, `· ${line}`));
    live.handle.events.on("session", (id: unknown) => {
      if (id) live.sessionRef = String(id);
    });
    live.handle.events.on("usage", (tokens: number) => this.store.addTokens(live.config.id, tokens));
    live.handle.events.on("error", (err: Error) => this.log(live.config.id, `[error] ${err.message}`));
    live.handle.events.on("exit", (info: { code: number | null }) => {
      // A wake sets "reconnecting" and THEN stops the old process — that process's exit event
      // must not clobber the state back to offline (it blanked the chat indicator mid-wake).
      const activity = this.store.getState().agentActivity[live.config.id];
      if (!activity || activity.state !== "reconnecting") {
        this.store.setAgentActivity(live.config.id, "offline");
      }
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
      // The agent may have exited without ever reading a chat message the user sent it
      // (it never polled get_chat again). Wake it once so the message isn't silently dropped.
      const pending = this.pendingUserMessage(live.config.id);
      if (pending && this.wokeForChatId.get(live.config.id) !== pending.id) {
        this.log(live.config.id, "exited before reading the user's chat message — waking it to reply");
        await this.wakeWithMessage(live, pending);
        return;
      }
      this.log(live.config.id, "finished its work and exited cleanly");
      return;
    }
    await this.resumeAfterCrash(live);
  }

  /** The newest user chat message this agent hasn't answered yet (ask-mode announcements
   *  excluded), or null. */
  private pendingUserMessage(agentId: string): ChatMessage | null {
    let lastUser: ChatMessage | null = null;
    let lastReply = 0;
    for (const m of this.store.getState().chat) {
      if (m.from === "user" && (m.to === "all" || m.to === agentId) && !m.text.startsWith("Ask mode is")) {
        lastUser = m;
      }
      if (m.from === agentId) lastReply = m.id;
    }
    return lastUser && lastUser.id > lastReply ? lastUser : null;
  }

  private async resumeAfterCrash(live: LiveAgent): Promise<void> {
    const max = this.opts?.maxResumes ?? 2;
    if (live.resumes >= max) {
      this.store.setAgentActivity(live.config.id, "offline", "crashed — needs a manual resume");
      this.log(live.config.id, `crashed ${live.resumes} times — giving up auto-resume. Run \`duo resume ${live.config.id}\`.`);
      return;
    }
    live.resumes += 1;
    this.store.setAgentActivity(live.config.id, "reconnecting", "restarting after a crash");
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

  private waking = new Set<string>();
  /** chatId of the last user message we relaunched each agent to handle — so handleExit doesn't
   *  wake the same agent twice for one message. */
  private wokeForChatId = new Map<string, number>();

  /** A user chat message arrived (rest.ts). Agents that are still running read it themselves via
   *  get_chat; an agent whose process already exited is relaunched with the message — this is how
   *  the user continues a session or gives further instructions after the agents finish.
   *  Broadcast ("all") messages only wake agents when no agent process is left running, so a
   *  general remark mid-session doesn't respawn an agent that already finished its part. */
  async deliverUserMessage(message: ChatMessage): Promise<void> {
    if (this.stopping || !this.config) return;
    const targets = message.to === "all" ? this.config.agents.map((a) => a.id) : [message.to];
    const done = this.store.getState().phase === "done";
    const anyRunning = [...this.agents.values()].some(
      (a) => a.handle.kind === "process" && !a.handle.exited
    );
    for (const id of targets) {
      const live = this.agents.get(id);
      if (!live) continue; // hub restarted since launch — `duo resume <id>` rebuilds the slot
      if (live.handle.kind === "manual") continue; // human-driven slot; the human reads the chat
      // Mid-session, a running agent reads the chat itself at its next pause. But once the session
      // is DONE, a process that still hasn't exited is just lingering (a dev server it spawned, an
      // idle turn) and will never call get_chat — stop it and wake it with the message instead.
      if (!live.handle.exited && !done) continue;
      if (message.to === "all" && anyRunning && !done) continue;
      await this.wakeWithMessage(live, message);
    }
  }

  /** Stop (if needed) and relaunch one agent with a chat follow-up prompt carrying `message`.
   *  Sets "reconnecting" up front so the chat shows a live indicator during the whole wake — the
   *  agent's re-registration in the follow-up kickoff flips it back to "working". */
  private async wakeWithMessage(live: LiveAgent, message: ChatMessage): Promise<void> {
    const id = live.config.id;
    if (this.waking.has(id) || this.stopping || !this.config) return;
    this.waking.add(id);
    this.wokeForChatId.set(id, message.id);
    try {
      this.store.setAgentActivity(id, "reconnecting", "waking up to answer your message");
      if (!live.handle.exited) await live.handle.stop().catch(() => undefined);
      this.log(id, "waking up to handle the user's chat message");
      const kickoff = assembleChatFollowUp(this.config, live.config, this.store.getState().goal, message.text);
      // Resume the agent's previous AI session (if the runner exposed one) so it remembers.
      const ctx = this.ctx(live.config, kickoff, live.sessionRef);
      await live.adapter.configure(ctx);
      live.handle = await live.adapter.launch(ctx);
      this.wireHandle(live);
    } catch (err) {
      this.store.setAgentActivity(id, "offline", "could not wake the agent");
      this.log(id, `[error] could not wake agent: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.waking.delete(id);
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
      this.store.setAgentActivity(agentId, "reconnecting", "resuming");
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

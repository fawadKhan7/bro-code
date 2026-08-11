/** The adapter contract. Everything AI-vendor-specific lives behind this — four methods,
 *  no more. See docs/02-architecture-upgrade/04-adapter-architecture.md and
 *  docs/04-strategies-and-design-principles/adapter-isolation.md.
 */
import type { EventEmitter } from "events";
import type { AgentConfig, Runner } from "@duo/shared";

export interface DetectResult {
  /** Is this runner usable on this machine? */
  ok: boolean;
  /** Version string if detectable. */
  version?: string;
  /** Human-readable reason when !ok, with the fix. */
  reason?: string;
}

export interface LaunchContext {
  agent: AgentConfig;
  kickoffPrompt: string;
  hubUrl: string;
  /** MCP server name to register in the client config (mcp.json key). */
  toolPrefix: string;
  /** Claude permission mode etc. — runner-specific knobs, passed opaquely. */
  runnerOptions?: Record<string, unknown>;
  /** Runner session id from a previous run of this agent (emitted via the handle's "session"
   *  event). When set, adapters that support it resume that AI session (claude --resume) so the
   *  agent remembers its earlier work — used when a chat message wakes a finished agent. */
  resumeSessionRef?: string;
}

/**
 * Returned by launch(). Lives until session end — the SAME process spans planning and
 * execution (hard invariant, docs/02-architecture-upgrade/07-long-lived-sessions.md).
 * "manual" = a human pasted the prompt (cursor-ide); there is no child process to watch.
 */
export interface AgentHandle {
  agentId: string;
  kind: "process" | "manual";
  /** "output" (stream text), "exit" ({ code }), "error" (Error), "session" (runner session id
   *  string, when the runner exposes one). Piped into hub logs / state by the supervisor. */
  events: EventEmitter;
  /** Terminate the underlying process (no-op for manual). */
  stop(): Promise<void>;
  /** For process handles: has it exited? */
  readonly exited: boolean;
}

export interface AgentAdapter {
  readonly runner: Runner;
  /** Binary present, version acceptable? */
  detect(): Promise<DetectResult>;
  /** Write MCP config + any rules files into the workspace. Idempotent (merge, never clobber). */
  configure(ctx: LaunchContext): Promise<void>;
  /** Start the agent with its kickoff prompt. Returns a handle living until session end. */
  launch(ctx: LaunchContext): Promise<AgentHandle>;
}

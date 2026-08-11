/** Core domain types for the Duo system. Agents are a list, never an A/B pair. */

export type SessionPhase = "init" | "planning" | "executing" | "done";
/** ask = conversational: agents confirm each significant step with the user in chat before acting. */
export type Mode = "auto-run" | "checkpoint" | "ask";

/** Which AI backs an agent slot. "fake" is used by the test suite. */
export type Runner = "claude-code" | "cursor-cli" | "cursor-ide" | "fake";

export interface AgentConfig {
  id: string;
  workspace: string;
  runner: Runner;
  /** Free-form role string — a planning bias, not a boundary. */
  role: string;
  /** Optional model override passed to the runner (e.g. "claude-opus-4-8", "sonnet-4"). */
  model?: string;
}

export interface Registration {
  workspacePath: string;
  connectedAt: string;
}

/** Live process state of an agent, set by the hub supervisor (v2).
 *  Drives the dashboard's "reconnecting… / replying…" indicator:
 *  starting = launched, not yet registered · working = process running ·
 *  reconnecting = being relaunched (chat wake or crash resume) · offline = process exited. */
export type AgentActivityState = "starting" | "working" | "reconnecting" | "offline";

export interface AgentActivity {
  state: AgentActivityState;
  /** Short human phrase for the UI, e.g. "waking up to answer your message". */
  detail?: string;
  since: string;
}

/** What agents send in post_plan. Deliberately no prose field. */
export interface PlanItemInput {
  title: string;
  /** Suggested owner (agent id); null/omitted = unassigned. */
  ownerHint?: string | null;
  paths?: string[];
}

export type BoardItemStatus = "open" | "claimed" | "done" | "out-of-scope";

export interface BoardItem {
  id: string;
  title: string;
  /** Assigned owner after plan approval. Approval blocks while any item is unowned. */
  owner: string | null;
  ownerHint: string | null;
  claimedBy: string | null;
  paths: string[];
  status: BoardItemStatus;
  /** File pointers left at completion for the peer. */
  refs: string[];
  /** Board version at last change — enables get_board(since_version) deltas. */
  version: number;
  proposedBy: string | null;
}

export interface LogEntry {
  agentId: string;
  message: string;
  refs?: string[];
  timestamp: string;
}

export interface Contract {
  agentId: string;
  /** One plain-language sentence: what was decided (v2). Written for a human reader. */
  summary?: string;
  content: string;
  timestamp: string;
  /** SHA-256 hex of content — detects drift across sessions. */
  contentHash: string;
  /** Monotonic per service slug. */
  revision: number;
  title?: string;
  /** Filename slug under contracts/<service>.md. */
  service: string;
  /** Absolute path written by the disk mirror, if successful. */
  diskPath?: string;
  /** Global contract version — enables get_contracts(since_version) deltas. */
  version: number;
}

export type CheckpointStatus = "pending" | "approved" | "feedback";

/** "question" = the agent is asking the user something and will not act until answered (v2). */
export type CheckpointKind = "checkpoint" | "question";

export interface Checkpoint {
  agentId: string;
  summary: string;
  nextStep: string;
  /** Why the agent is pausing — what the user's approval means (v2, plain language). */
  why?: string;
  /** What happens if the user approves (v2, plain language). */
  impact?: string;
  /** A pure question pauses without proposing an action; the answer arrives via feedback. */
  kind?: CheckpointKind;
  status: CheckpointStatus;
  feedback?: string;
  timestamp: string;
}

/** One entry in the user ↔ agents conversation. Distinct from LogEntry (machine progress
 *  lines): chat is written to be read and answered — by the user or by an agent. */
export interface ChatMessage {
  /** Monotonic id (= chatVersion at post time) — enables get_chat(since_id) deltas. */
  id: number;
  /** "user" or an agent id. */
  from: string;
  /** "user", "all" (every agent), or a specific agent id. */
  to: string;
  text: string;
  timestamp: string;
}

export interface SessionState {
  active: boolean;
  phase: SessionPhase;
  goal: string;
  mode: Mode;
  /** Trivial-plan fast path (≤2 items, all owned → auto-approve). Default true. */
  autoApproveTrivial: boolean;
  agents: AgentConfig[];
  registrations: Record<string, Registration | undefined>;
  planProposals: Record<string, PlanItemInput[] | undefined>;
  /** Human-readable plan digest per agent, posted with the plan (v2). */
  planSummaries: Record<string, string | undefined>;
  /** Merged, not-yet-approved board (planning phase). */
  proposedBoard: BoardItem[];
  board: BoardItem[];
  boardVersion: number;
  contracts: Contract[];
  contractVersion: number;
  contractRevisionBySlug: Record<string, number>;
  checkpoints: Record<string, Checkpoint | undefined>;
  logs: LogEntry[];
  /** User ↔ agents conversation (the chat section). */
  chat: ChatMessage[];
  chatVersion: number;
  lastFeedback: string | null;
  resumeBriefVersion: number;
  startedAt: string;
  /** Set by the hub supervisor when launching/registration fails — surfaced to clients (v2). */
  launchError: string | null;
  /** Cumulative tokens per agent, parsed from runner stream-json usage (v2). */
  tokensByAgent: Record<string, number>;
  /** Live process state per agent, set by the supervisor (v2). */
  agentActivity: Record<string, AgentActivity | undefined>;
}

export function emptySession(): SessionState {
  return {
    active: false,
    phase: "init",
    goal: "",
    mode: "auto-run",
    autoApproveTrivial: true,
    agents: [],
    registrations: {},
    planProposals: {},
    planSummaries: {},
    proposedBoard: [],
    board: [],
    boardVersion: 0,
    contracts: [],
    contractVersion: 0,
    contractRevisionBySlug: {},
    checkpoints: {},
    logs: [],
    chat: [],
    chatVersion: 0,
    lastFeedback: null,
    resumeBriefVersion: 0,
    startedAt: "",
    launchError: null,
    tokensByAgent: {},
    agentActivity: {},
  };
}

/** Event pushed to SSE subscribers (CLI watch, dashboard). */
export interface HubEvent {
  type: "log" | "board" | "checkpoint" | "status" | "registration" | "phase" | "plan" | "chat";
  data: unknown;
}

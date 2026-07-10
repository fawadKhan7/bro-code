/** Core domain types for the Duo system. Agents are a list, never an A/B pair. */

export type SessionPhase = "init" | "planning" | "executing" | "done";
export type Mode = "auto-run" | "checkpoint";

/** Which AI backs an agent slot. "fake" is used by the test suite. */
export type Runner = "claude-code" | "cursor-cli" | "cursor-ide" | "fake";

export interface AgentConfig {
  id: string;
  workspace: string;
  runner: Runner;
  /** Free-form role string — a planning bias, not a boundary. */
  role: string;
}

export interface Registration {
  workspacePath: string;
  connectedAt: string;
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

export interface Checkpoint {
  agentId: string;
  summary: string;
  nextStep: string;
  status: CheckpointStatus;
  feedback?: string;
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
  /** Merged, not-yet-approved board (planning phase). */
  proposedBoard: BoardItem[];
  board: BoardItem[];
  boardVersion: number;
  contracts: Contract[];
  contractVersion: number;
  contractRevisionBySlug: Record<string, number>;
  checkpoints: Record<string, Checkpoint | undefined>;
  logs: LogEntry[];
  lastFeedback: string | null;
  resumeBriefVersion: number;
  startedAt: string;
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
    proposedBoard: [],
    board: [],
    boardVersion: 0,
    contracts: [],
    contractVersion: 0,
    contractRevisionBySlug: {},
    checkpoints: {},
    logs: [],
    lastFeedback: null,
    resumeBriefVersion: 0,
    startedAt: "",
  };
}

/** Event pushed to SSE subscribers (CLI watch, dashboard). */
export interface HubEvent {
  type: "log" | "board" | "checkpoint" | "status" | "registration" | "phase" | "plan";
  data: unknown;
}

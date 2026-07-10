/** SessionStore — the single writer over all session state.
 *  Rules enforced here: phase gates, claim validation, the completion rule,
 *  idempotent re-calls, write-through persistence, versioned reads.
 *  See docs/04-strategies-and-design-principles/state-management.md.
 */
import { EventEmitter } from "events";
import { type AgentConfig, type BoardItem, type LogEntry, type Mode, type PlanItemInput, type SessionState } from "@duo/shared";
export interface CreateSessionInput {
    goal: string;
    agents: AgentConfig[];
    mode?: Mode;
    /** false = --no-plan: session starts in `executing` with a pre-filled board. */
    plan?: boolean;
    /** Board pre-fill for --no-plan (one item per agent, preset-derived — built by the CLI). */
    presetBoard?: PlanItemInput[];
    autoApproveTrivial?: boolean;
}
export interface PlanApprovalEdits {
    /** taskId → agentId */
    assign?: Record<string, string>;
    add?: PlanItemInput[];
    remove?: string[];
    outOfScope?: string[];
}
export interface PlanDecision {
    approved: boolean;
    feedback?: string;
    edits?: PlanApprovalEdits;
}
/** Cheap, structured out-of-phase / rule-violation answer. Never a throw, never a hang. */
export interface ToolRejection {
    ok: false;
    phase: string;
    error: string;
}
export declare class SessionStore {
    private persistFile;
    readonly events: EventEmitter<[never]>;
    private state;
    private planWaiters;
    private checkpointWaiters;
    constructor(persistFile: string);
    /** Write-through: called after every mutation, before the mutating call returns. */
    private persist;
    /** Restore a persisted session (hub restart). Returns true if one was loaded. */
    loadFromDisk(): boolean;
    getState(): Readonly<SessionState>;
    private emit;
    private rejection;
    createSession(input: CreateSessionInput): {
        ok: true;
    } | ToolRejection;
    /** Archive to history and reset. Returns the archive path (or null if nothing active). */
    stopSession(historyDirPath: string): string | null;
    registerAgent(agentId: string, workspacePath: string): {
        ok: true;
        agentId: string;
        role: string;
    } | ToolRejection;
    registrationStatus(): Record<string, {
        workspacePath: string;
        connectedAt: string;
    } | null>;
    allRegistered(): boolean;
    /** Adapter reports an agent process exited: reopen its claims. */
    releaseAgent(agentId: string): {
        ok: true;
        reopened: string[];
    };
    private toBoardItem;
    postPlan(agentId: string, items: PlanItemInput[]): object | ToolRejection;
    /** Merge all proposals: concat in agent order, de-dup by normalized title or identical path sets. */
    private mergeProposals;
    planStatus(): object;
    /** Long-poll: resolves on approve/feedback, or {pending} after timeoutMs. */
    awaitPlanApproval(timeoutMs: number): Promise<PlanDecision | {
        pending: true;
        retry: true;
    }>;
    private resolvePlanWaiters;
    approvePlan(edits: PlanApprovalEdits): {
        ok: true;
        board: BoardItem[];
    } | ToolRejection;
    planFeedback(message: string): {
        ok: true;
    } | ToolRejection;
    getBoard(sinceVersion?: number): object;
    claimTask(agentId: string, taskId: string): object | ToolRejection;
    completeTask(agentId: string, taskId: string, refs?: string[]): object | ToolRejection;
    /** Human-only: mark items out of scope during execution (agents cannot shrink the goal). */
    markOutOfScope(taskIds: string[]): object | ToolRejection;
    postContract(agentId: string, content: string, title?: string, service?: string): object | ToolRejection;
    getContracts(sinceVersion?: number): object;
    private pushLog;
    postUpdate(agentId: string, message: string, refs?: string[]): object | ToolRejection;
    getLogs(): LogEntry[];
    postCheckpoint(agentId: string, summary: string, nextStep: string): object | ToolRejection;
    resolveCheckpoint(agentId: string, approved: boolean, feedback?: string): object | ToolRejection;
    getCheckpointStatus(agentId: string): object;
    /** Optional long-poll: resolves when the pending checkpoint is resolved, or after timeoutMs. */
    awaitCheckpoint(agentId: string, timeoutMs: number): Promise<object>;
    resumeBrief(agentId: string): object | ToolRejection;
    getStatus(): object;
    sessionBrief(agentId: string): object | ToolRejection;
}
//# sourceMappingURL=store.d.ts.map
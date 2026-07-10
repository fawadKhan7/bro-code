export type AgentId = "agent-a" | "agent-b";
export type PresetId = "frontend-backend" | "builder-reviewer" | "architect-implementer" | "feature-tests" | "service-ab" | "custom";
export type CheckpointPhase = "idle" | "waiting_user" | "resumed";
export interface ConductorConfig {
    pathA: string;
    pathB: string;
    preset: PresetId;
    customRoleA?: string;
    customRoleB?: string;
}
export interface ContractDiff {
    added?: string[];
    removed?: string[];
    changed?: string[];
}
export interface ContractUpdate {
    version: number;
    from: AgentId;
    type: string;
    summary: string;
    diff?: ContractDiff;
    refs?: string[];
    timestamp: string;
}
export interface AgentCheckpoint {
    summary: string;
    nextStep: string;
    status: "pending" | "approved";
    timestamp: string;
}
export interface ConductorSession {
    active: boolean;
    goal: string;
    preset: PresetId;
    pathA: string;
    pathB: string;
    briefA: string;
    briefB: string;
    injectedRuleA: string;
    injectedRuleB: string;
    contractVersion: number;
    updates: ContractUpdate[];
    checkpointA: AgentCheckpoint | null;
    checkpointB: AgentCheckpoint | null;
    checkpointPhase: CheckpointPhase;
    lastFeedback: string | null;
    resumeBriefVersion: number;
    resumeBrief: string | null;
    startedAt: string;
}
export declare const INJECTED_RULE_FILENAME = "conductor-session.mdc";

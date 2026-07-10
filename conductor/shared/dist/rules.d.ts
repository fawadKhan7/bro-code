import type { AgentId } from "./types";
export declare function injectedRulePath(workspaceRoot: string): string;
export declare function buildRuleContent(agentId: AgentId, brief: string, projectMap: string): string;
export declare function injectRule(workspaceRoot: string, agentId: AgentId, brief: string, projectMap: string): string;
export declare function removeInjectedRule(workspaceRoot: string): void;

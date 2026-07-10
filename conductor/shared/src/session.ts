import * as fs from "fs";
import type { AgentCheckpoint, AgentId, ConductorSession, ContractUpdate } from "./types";
import { sessionPath, conductorHome } from "./paths";
import { formatContractLines } from "./contractFormat";
import { buildResumeBrief } from "./resumeBrief";

export function emptySession(): ConductorSession {
  return {
    active: false,
    goal: "",
    preset: "frontend-backend",
    pathA: "",
    pathB: "",
    briefA: "",
    briefB: "",
    injectedRuleA: "",
    injectedRuleB: "",
    contractVersion: 0,
    updates: [],
    checkpointA: null,
    checkpointB: null,
    checkpointPhase: "idle",
    lastFeedback: null,
    resumeBriefVersion: 0,
    resumeBrief: null,
    startedAt: "",
  };
}

export function loadSession(): ConductorSession {
  try {
    const raw = fs.readFileSync(sessionPath(), "utf8");
    return { ...emptySession(), ...(JSON.parse(raw) as ConductorSession) };
  } catch {
    return emptySession();
  }
}

export function saveSession(session: ConductorSession): void {
  fs.mkdirSync(conductorHome(), { recursive: true });
  fs.writeFileSync(sessionPath(), JSON.stringify(session, null, 2), "utf8");
}

export function updateSession(mutator: (s: ConductorSession) => void): ConductorSession {
  const session = loadSession();
  mutator(session);
  saveSession(session);
  return session;
}

export function appendUpdate(
  session: ConductorSession,
  input: Omit<ContractUpdate, "version" | "timestamp">
): ContractUpdate {
  const version = session.contractVersion + 1;
  const entry: ContractUpdate = {
    ...input,
    version,
    timestamp: new Date().toISOString(),
  };
  session.contractVersion = version;
  session.updates.push(entry);
  return entry;
}

export function getContractDelta(session: ConductorSession, sinceVersion: number): string {
  const slice = session.updates.filter((u) => u.version > sinceVersion);
  return formatContractLines(slice);
}

export function applyFeedback(session: ConductorSession, feedback: string | null): void {
  const msg = feedback?.trim() ?? "";
  session.lastFeedback = msg || null;
  session.checkpointPhase = "resumed";
  if (session.checkpointA?.status === "pending") session.checkpointA.status = "approved";
  if (session.checkpointB?.status === "pending") session.checkpointB.status = "approved";
  session.resumeBriefVersion += 1;
  session.resumeBrief = buildResumeBrief(session, msg || null);
  saveSession(session);
}

export function setCheckpoint(
  session: ConductorSession,
  agentId: AgentId,
  summary: string,
  nextStep: string
): void {
  const cp: AgentCheckpoint = {
    summary,
    nextStep,
    status: "pending",
    timestamp: new Date().toISOString(),
  };
  if (agentId === "agent-a") session.checkpointA = cp;
  else session.checkpointB = cp;
  session.checkpointPhase = "waiting_user";
}

export function peerId(agentId: AgentId): AgentId {
  return agentId === "agent-a" ? "agent-b" : "agent-a";
}

import type { ConductorSession } from "./types";
import { formatContractLines } from "./contractFormat";

/** Condensed context after checkpoint resume — no LLM. */
export function buildResumeBrief(session: ConductorSession, feedback: string | null): string {
  const recent = session.updates.slice(-8);
  const lines: string[] = [
    `# Resume brief (v${session.resumeBriefVersion})`,
    "",
    `**Goal:** ${session.goal}`,
    "",
  ];
  if (feedback) {
    lines.push(`**User feedback:** ${feedback}`, "");
  }
  lines.push("## Recent contract updates", "", formatContractLines(recent), "");
  const pendingA = session.checkpointA?.status === "pending";
  const pendingB = session.checkpointB?.status === "pending";
  if (!pendingA && !pendingB) {
    lines.push("## Checkpoints", "", "All checkpoints cleared. Continue with the shared goal.", "");
  }
  lines.push(
    "Use `get_contract` with your last `sinceVersion` for anything older than the list above."
  );
  return lines.join("\n");
}

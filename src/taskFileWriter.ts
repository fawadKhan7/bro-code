import * as fs from "fs";
import * as path from "path";

export function buildTasksMarkdown(agentId: string, task: string, mode: string): string {
  const modeLabel =
    mode === "checkpoint"
      ? "Checkpoint (pause at milestones for user review)"
      : "Auto-run (work until done)";

  return `# Duo Agent — Agent ${agentId} Task

## Mode: ${modeLabel}

## Your Task

${task}

## Collaboration Rules

- Use \`post_contract\` to share interfaces, API shapes, or data formats with the other agent.
- Use \`get_contracts\` regularly to see what the other agent has shared.
- Use \`post_update\` to log your progress (visible in the Duo Agent panel).
${
  mode === "checkpoint"
    ? "- CHECKPOINT mode: call `post_checkpoint` before any major or irreversible action and wait for user approval via `get_checkpoint_status`."
    : "- AUTO-RUN mode: work until your task is fully complete."
}

Each \`post_contract\` also appends a revision under \`contracts/<service>.md\` in this workspace (disk mirror for CI and humans). Legacy \`CONTRACTS.md\` may still exist as a template; prefer \`contracts/*.md\` for authoritative history.
`;
}

export const CONTRACTS_TEMPLATE = `# Duo Agent — Shared Contracts (legacy)

Authoritative contract history is written to \`contracts/<service>.md\` on each \`post_contract\` call.
You can keep this file for notes or delete it if you only use \`contracts/*.md\`.

---

<!-- Optional manual notes -->
`;

/** Writes TASKS.md and creates CONTRACTS.md if missing (Node fs — used by CLI and extension). */
export function writeTaskFilesToDisk(
  workspaceRoot: string,
  agentId: string,
  task: string,
  mode: string
): void {
  const tasksPath = path.join(workspaceRoot, "TASKS.md");
  fs.writeFileSync(tasksPath, buildTasksMarkdown(agentId, task, mode), "utf8");

  const contractsPath = path.join(workspaceRoot, "CONTRACTS.md");
  if (!fs.existsSync(contractsPath)) {
    fs.writeFileSync(contractsPath, CONTRACTS_TEMPLATE, "utf8");
  }
}

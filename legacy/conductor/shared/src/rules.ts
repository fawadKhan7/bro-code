import * as fs from "fs";
import * as path from "path";
import type { AgentId } from "./types";
import { INJECTED_RULE_FILENAME } from "./types";

export function injectedRulePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".cursor", "rules", INJECTED_RULE_FILENAME);
}

export function buildRuleContent(
  agentId: AgentId,
  brief: string,
  projectMap: string
): string {
  const mapSection = projectMap.trim()
    ? `\n\n## Project map\n\n${projectMap.trim()}`
    : "";

  return `---
description: Conductor session — auto-injected; removed on conductor stop
alwaysApply: true
---

# Conductor session

**Your agent id:** \`${agentId}\` (use this in all Conductor MCP tool calls)

## Your brief

${brief.trim()}
${mapSection}

## MCP protocol (Conductor server)

1. Before new work that depends on the other agent: \`get_contract\` with \`sinceVersion\` set to the last version you processed.
2. After producing something the other agent needs: \`post_update\` with \`type\`, \`summary\`, optional \`diff\`, and \`refs\` (file paths relative to project root).
3. After a major feature: \`post_checkpoint\` — both agents pause until the user runs \`conductor feedback\`.
4. After checkpoint resume: \`get_resume_brief\` once, then continue with \`get_contract\` deltas only.
5. To see peer progress: \`get_status\`.

Do not poll \`get_contract\` in a tight loop. Read file contents locally using \`refs\` from contract lines.
`;
}

export function injectRule(workspaceRoot: string, agentId: AgentId, brief: string, projectMap: string): string {
  const filePath = injectedRulePath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = buildRuleContent(agentId, brief, projectMap);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

export function removeInjectedRule(workspaceRoot: string): void {
  const filePath = injectedRulePath(workspaceRoot);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* best effort */
  }
}

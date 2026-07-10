import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { buildTasksMarkdown, CONTRACTS_TEMPLATE } from "./taskFileWriter";

export async function writeAgentTaskFile(
  agentId: string,
  task: string,
  mode: string,
  workspacePath?: string
): Promise<void> {
  const root = workspacePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;

  const tasksUri = vscode.Uri.file(path.join(root, "TASKS.md"));
  await vscode.workspace.fs.writeFile(tasksUri, Buffer.from(buildTasksMarkdown(agentId, task, mode), "utf8"));

  const contractsPath = path.join(root, "CONTRACTS.md");
  if (!fs.existsSync(contractsPath)) {
    const contractsUri = vscode.Uri.file(contractsPath);
    await vscode.workspace.fs.writeFile(contractsUri, Buffer.from(CONTRACTS_TEMPLATE, "utf8"));
  }
}

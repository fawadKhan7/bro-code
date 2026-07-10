import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { DuoAgentMcpServer, AgentId, Mode } from "./mcpServer";
import { writeTaskFilesToDisk } from "./taskFileWriter";
import { buildDuoProtocolMdc } from "./mcpToolCatalog";

async function appendGitignorePatterns(workspaceUri: vscode.Uri, patterns: string[]): Promise<void> {
  const gi = vscode.Uri.joinPath(workspaceUri, ".gitignore");
  let text = "";
  try {
    const buf = await vscode.workspace.fs.readFile(gi);
    text = Buffer.from(buf).toString("utf8");
  } catch {
    text = "";
  }
  const existing = new Set(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  );
  const toAdd = patterns.filter((p) => !existing.has(p));
  if (toAdd.length === 0) return;
  const prefix = text.length === 0 ? "" : text.endsWith("\n") ? "" : "\n";
  const block =
    `${prefix}\n# Duo Agent — optional local artifacts (remove if you commit contracts/digests)\n` +
    `${toAdd.join("\n")}\n`;
  await vscode.workspace.fs.writeFile(gi, Buffer.from(text + block, "utf8"));
}

async function installProtocolRules(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage("Duo Agent: Open a workspace folder first.");
    return;
  }
  const rulesDir = vscode.Uri.joinPath(folder.uri, ".cursor", "rules");
  await vscode.workspace.fs.createDirectory(rulesDir);
  const body = buildDuoProtocolMdc();
  const target = vscode.Uri.joinPath(rulesDir, "duo-protocol.mdc");
  await vscode.workspace.fs.writeFile(target, Buffer.from(body, "utf8"));
  const choice = await vscode.window.showInformationMessage(
    "Duo Agent: wrote .cursor/rules/duo-protocol.mdc (generated from the live MCP tool catalog). Re-run this command after upgrading the extension.",
    "Add contracts/ & duo-digest.md to .gitignore",
    "Close"
  );
  if (choice === "Add contracts/ & duo-digest.md to .gitignore") {
    await appendGitignorePatterns(folder.uri, ["contracts/", "duo-digest.md"]);
    vscode.window.showInformationMessage("Duo Agent: updated .gitignore.");
  }
}

const MCP_PORT = 3131;

// The server instance — only set in the window that actually started it
let mcpServer: DuoAgentMcpServer | null = null;

// True when this window detected the server running from another window
let proxyMode = false;

// ── HTTP helpers for proxy-mode operations ─────────────────────────────────

function serverHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${MCP_PORT}/health`, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}

function apiGet<T = unknown>(apiPath: string): Promise<{ data: T; status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: "127.0.0.1", port: MCP_PORT, path: apiPath },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          try {
            resolve({ data: JSON.parse(raw) as T, status: res.statusCode ?? 200 });
          } catch {
            resolve({ data: {} as T, status: res.statusCode ?? 200 });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error("GET timeout"));
    });
  });
}

function apiPost<T = unknown>(apiPath: string, body: object): Promise<{ data: T; status: number }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: MCP_PORT,
        path: apiPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          try {
            resolve({ data: JSON.parse(raw) as T, status: res.statusCode ?? 200 });
          } catch {
            resolve({ data: {} as T, status: res.statusCode ?? 200 });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ── Extension entry points ──────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext) {
  const provider = new DuoAgentViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("duo-agent.panel", provider, {
      // Keep the webview's JS state alive when the panel is hidden.
      // Without this, hiding and reshowing the panel destroys and recreates the
      // webview, causing postMessage calls to race against JS initialization and
      // the UI to reset back to "Stopped".
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("duo-agent.startServer", () => provider.startServer()),
    vscode.commands.registerCommand("duo-agent.stopServer", () => provider.stopServer()),
    vscode.commands.registerCommand("duo-agent.openPanel", () => {
      vscode.commands.executeCommand("duo-agent.panel.focus");
    }),
    vscode.commands.registerCommand("duo-agent.openControlTerminal", () => provider.openControlTerminal()),
    vscode.commands.registerCommand("duo-agent.installProtocolRules", installProtocolRules)
  );

  // Auto-start: try to start the server; if already running, switch to proxy mode
  await provider.startServer(true);
}

export function deactivate() {
  mcpServer?.stop();
}

// ── View provider ───────────────────────────────────────────────────────────

class DuoAgentViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _updateReq: http.ClientRequest | null = null;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /** Session terminal + Stop only in the window that owns the server process (neutral for other windows). */
  private postServerStarted(): void {
    const canControlSession = !proxyMode && !!mcpServer?.isRunning();
    this._view?.webview.postMessage({
      type: "serverStarted",
      port: MCP_PORT,
      canControlSession,
    });
  }

  /** Runs the session CLI (tasks, MCP snippet) — only from the window running the server. */
  openControlTerminal(): void {
    if (proxyMode) {
      vscode.window.showWarningMessage(
        "Duo Agent: Open Session Terminal in the Cursor window where you started the server (this window only has the client)."
      );
      return;
    }
    if (!mcpServer?.isRunning()) {
      vscode.window.showErrorMessage("Duo Agent: Start the server from this window first.");
      return;
    }
    const cliPath = path.join(this._extensionUri.fsPath, "out", "duoControlCli.js");
    if (!fs.existsSync(cliPath)) {
      vscode.window.showErrorMessage(
        `Duo Agent: Session CLI missing. Run npm run compile. Expected: ${cliPath}`
      );
      return;
    }
    const term = vscode.window.createTerminal({ name: "Duo Agent Session" });
    term.show();
    term.sendText(`node "${cliPath}"`, true);
  }

  async resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    // State sync happens in response to the "ready" message sent by the webview
    // once its JavaScript has fully loaded. This avoids the race where postMessage
    // calls arrive before the webview JS is initialised and are silently dropped.
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case "ready":         await this.syncStateToWebview(); break;
        case "startServer":   await this.startServer(); break;
        case "stopServer":    await this.stopServer(); break;
        case "connectAgent":  await this.connectAgent(); break;
        case "disconnectAgent": await this.disconnectAgent(msg.agentId as AgentId); break;
        case "openControlTerminal": this.openControlTerminal(); break;
        case "resolveCheckpoint": await this.resolveCheckpoint(msg.agentId as AgentId, msg.approved, msg.feedback); break;
        case "showError":     vscode.window.showErrorMessage(msg.text); break;
        case "submitTask":
          await this.submitTaskFromPanel(
            msg.agentId as AgentId,
            String(msg.instructions ?? ""),
            (msg.paths as string[]) ?? [],
            (msg.mode as Mode) === "checkpoint" ? "checkpoint" : "auto-run"
          );
          break;
        case "pickScopeFiles":
          await this.pickScopeFiles(msg.agentId as AgentId);
          break;
        case "addOpenEditorsToScope":
          this.addOpenEditorsToScope(msg.agentId as AgentId);
          break;
      }
    });
  }

  private async submitTaskFromPanel(
    agentId: AgentId,
    instructions: string,
    paths: string[],
    mode: Mode
  ): Promise<void> {
    const trimmed = instructions.trim();
    if (!trimmed && paths.length === 0) {
      vscode.window.showErrorMessage("Duo Agent: Add a task description and/or at least one scoped path.");
      return;
    }
    let full = trimmed;
    if (paths.length > 0) {
      const lines = paths.map((p) => `- \`${p.replace(/\\/g, "/")}\``).join("\n");
      full += (full ? "\n\n" : "") + "## Scope (files & folders)\n" + lines;
    }
    try {
      if (proxyMode) {
        const { status, data } = await apiPost<{ error?: string }>("/api/task", {
          agent_id: agentId,
          task: full,
          mode,
        });
        if (status !== 200) {
          vscode.window.showErrorMessage(data?.error ?? `Task API HTTP ${status}`);
          return;
        }
        const { data: st } = await apiGet<{
          workspaceA?: string | null;
          workspaceB?: string | null;
        }>("/api/status");
        const ws = agentId === "A" ? st.workspaceA : st.workspaceB;
        if (ws) writeTaskFilesToDisk(ws, agentId, full, mode);
      } else {
        if (!mcpServer?.isRunning()) {
          vscode.window.showErrorMessage("Duo Agent: Server is not running.");
          return;
        }
        mcpServer.assignSingleTask(agentId, full, mode);
        const st = mcpServer.getStatus();
        const ws = agentId === "A" ? st.workspaceA : st.workspaceB;
        if (ws) writeTaskFilesToDisk(ws, agentId, full, mode);
      }
      vscode.window.showInformationMessage(
        `Duo Agent: task saved for Agent ${agentId}. In each window, Agent chat → get_my_task (poll if waiting).`
      );
      this._view?.webview.postMessage({ type: "taskSaved", agentId });
    } catch (e) {
      vscode.window.showErrorMessage(`Duo Agent: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async pickScopeFiles(agentId: AgentId): Promise<void> {
    const def = vscode.workspace.workspaceFolders?.[0]?.uri;
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: true,
      openLabel: "Add to Duo task scope",
      defaultUri: def,
    });
    if (!picked?.length) return;
    this._view?.webview.postMessage({
      type: "scopePathsAdded",
      agentId,
      paths: picked.map((u) => u.fsPath),
    });
  }

  private addOpenEditorsToScope(agentId: AgentId): void {
    const paths = new Set<string>();
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.scheme === "file") {
        paths.add(ed.document.uri.fsPath);
      }
    }
    if (paths.size === 0) {
      vscode.window.showWarningMessage("Duo Agent: No file editors open to add.");
      return;
    }
    this._view?.webview.postMessage({ type: "scopePathsAdded", agentId, paths: [...paths] });
  }

  // Sends the current server + registration state to the webview.
  // Called only after the webview signals it is ready to receive messages.
  private async syncStateToWebview(): Promise<void> {
    const view = this._view;
    if (!view) return;

    const isRunning = mcpServer?.isRunning() || proxyMode;
    if (!isRunning) return;

    this.postServerStarted();

    if (proxyMode) {
      this.subscribeToUpdates();
    }

    // Restore agent connection if this workspace is already registered
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return;

    if (mcpServer) {
      const regStatus = mcpServer.getRegistrationStatus();
      for (const id of ["A", "B"] as AgentId[]) {
        if (regStatus[id]?.workspacePath === workspacePath) {
          view.webview.postMessage({ type: "agentConnected", agentId: id, workspacePath });
          break;
        }
      }
    } else if (proxyMode) {
      apiPost<{ registrations: { A: { workspacePath: string } | null; B: { workspacePath: string } | null } }>(
        "/api/status", {}
      ).then(({ data }) => {
        if (!data?.registrations) return;
        for (const id of ["A", "B"] as AgentId[]) {
          if (data.registrations[id]?.workspacePath === workspacePath) {
            view.webview.postMessage({ type: "agentConnected", agentId: id, workspacePath });
            break;
          }
        }
      }).catch(() => {});
    }
  }

  // ── Server ─────────────────────────────────────────────────────────────────

  async startServer(silent = false) {
    if (mcpServer?.isRunning() || proxyMode) {
      if (!silent) vscode.window.showInformationMessage("Duo Agent: MCP server is already running.");
      return;
    }

    // Check if another window already has the server running
    const alreadyUp = await serverHealthy();
    if (alreadyUp) {
      proxyMode = true;
      this.postServerStarted();
      this.subscribeToUpdates();
      if (!silent) vscode.window.showInformationMessage("Duo Agent: Connected to existing MCP server.");
      return;
    }

    mcpServer = new DuoAgentMcpServer((event) => {
      this._view?.webview.postMessage(event);
    });

    try {
      await mcpServer.start(MCP_PORT);
      this.postServerStarted();
      if (!silent) {
        vscode.window.showInformationMessage(`Duo Agent: MCP server started on port ${MCP_PORT}.`);
        this.openControlTerminal();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("EADDRINUSE")) {
        // Race condition: another window started it between our health check and now
        proxyMode = true;
        mcpServer = null;
        this.postServerStarted();
        this.subscribeToUpdates();
      } else {
        vscode.window.showErrorMessage(`Duo Agent: Failed to start server — ${msg}`);
      }
    }
  }

  async stopServer() {
    if (proxyMode) {
      vscode.window.showWarningMessage(
        "Duo Agent: Stop the server from the Cursor window that started it (this window is a client only)."
      );
      return;
    }
    if (!mcpServer?.isRunning()) return;

    await mcpServer.stop();
    mcpServer = null;
    this._view?.webview.postMessage({ type: "serverStopped" });
    vscode.window.showInformationMessage("Duo Agent: MCP server stopped.");
  }

  // ── Subscribe to server update stream (proxy mode) ─────────────────────────

  private subscribeToUpdates(): void {
    this._updateReq?.destroy();
    this._updateReq = http.get(
      `http://127.0.0.1:${MCP_PORT}/api/updates`,
      (res) => {
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (line) {
              try {
                const event = JSON.parse(line.slice(6));
                this._view?.webview.postMessage(event);
              } catch { /* ignore malformed */ }
            }
          }
        });
        res.on("end", () => {
          // Server closed connection — retry after a short delay
          setTimeout(() => {
            if (proxyMode) this.subscribeToUpdates();
          }, 3000);
        });
      }
    );
    this._updateReq.on("error", () => {
      setTimeout(() => {
        if (proxyMode) this.subscribeToUpdates();
      }, 3000);
    });
  }

  // ── Agent connection ───────────────────────────────────────────────────────

  async connectAgent() {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      vscode.window.showErrorMessage("Duo Agent: Open a folder in this window first.");
      this._view?.webview.postMessage({ type: "connectionFailed", reason: "No workspace folder open in this window." });
      return;
    }

    if (proxyMode) {
      try {
        const { data, status } = await apiPost<{ agentId?: AgentId; error?: string }>(
          "/api/register",
          { workspace_path: workspacePath }
        );
        if (status === 200 && data.agentId) {
          this._view?.webview.postMessage({ type: "agentConnected", agentId: data.agentId, workspacePath });
          vscode.window.showInformationMessage(`Duo Agent: Connected as Agent ${data.agentId} — ${path.basename(workspacePath)}`);
        } else {
          this._view?.webview.postMessage({ type: "connectionFailed", reason: data.error ?? "Could not register." });
        }
      } catch {
        this._view?.webview.postMessage({ type: "connectionFailed", reason: "Could not reach the MCP server." });
      }
      return;
    }

    if (!mcpServer?.isRunning()) {
      vscode.window.showErrorMessage("Duo Agent: Start the MCP server first.");
      return;
    }

    const result = mcpServer.registerAgent(workspacePath);
    if ("error" in result) {
      vscode.window.showErrorMessage(`Duo Agent: ${result.error}`);
      this._view?.webview.postMessage({ type: "connectionFailed", reason: result.error });
      return;
    }

    this._view?.webview.postMessage({ type: "agentConnected", agentId: result.agentId, workspacePath });
    vscode.window.showInformationMessage(`Duo Agent: Connected as Agent ${result.agentId} — ${path.basename(workspacePath)}`);
  }

  async disconnectAgent(agentId: AgentId) {
    if (proxyMode) {
      await apiPost("/api/deregister", { agent_id: agentId }).catch(() => {});
    } else {
      mcpServer?.deregisterAgent(agentId);
    }
    this._view?.webview.postMessage({ type: "agentDisconnected" });
  }

  // ── Checkpoint ─────────────────────────────────────────────────────────────

  async resolveCheckpoint(agentId: AgentId, approved: boolean, feedback?: string) {
    if (proxyMode) {
      await apiPost("/api/resolve-checkpoint", { agent_id: agentId, approved, feedback }).catch(() => {});
    } else {
      mcpServer?.resolveCheckpoint(agentId, approved, feedback);
    }
  }

  // ── HTML ───────────────────────────────────────────────────────────────────

  private getHtml(): string {
    const htmlPath = path.join(this._extensionUri.fsPath, "src", "panel", "webview.html");
    return fs.readFileSync(htmlPath, "utf8");
  }
}

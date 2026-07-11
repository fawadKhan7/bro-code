#!/usr/bin/env node
/**
 * Duo Agent control terminal — talks to the MCP HTTP server on 127.0.0.1:3131.
 * Run from the host Cursor window (same machine as the server).
 */
import * as http from "http";
import * as readline from "readline";
import { writeTaskFilesToDisk } from "./taskFileWriter";

const PORT = 3131;
const HOST = "127.0.0.1";

function mcpConfigSnippet(): string {
  return JSON.stringify(
    { mcpServers: { "duo-agent": { url: `http://127.0.0.1:${PORT}/sse` } } },
    null,
    2
  );
}

function printSessionBanner(): void {
  const line = "═".repeat(58);
  console.log(line);
  console.log("  Duo Agent — session terminal");
  console.log(`  MCP SSE: http://${HOST}:${PORT}/sse`);
  console.log("");
  console.log("  One-time: merge this into your Cursor MCP file");
  console.log("  Windows: %USERPROFILE%\\.cursor\\mcp.json");
  console.log("");
  console.log(mcpConfigSnippet());
  console.log("");
  console.log("  This CLI only talks to localhost — same on every machine.");
  console.log("  Live board: SSE /api/updates (watch off to disable).");
  console.log("  Commands: status · task A|B · mode · disarm · watch · help");
  console.log(line + "\n");
}

type Mode = "auto-run" | "checkpoint";
type AgentId = "A" | "B";

let currentMode: Mode = "auto-run";

function httpGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${HOST}:${PORT}${path}`, (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => (raw += c.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function httpPost(path: string, json: object): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(json);
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => (raw += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw }));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function fetchStatus(): Promise<Record<string, unknown>> {
  const { status, body } = await httpGet("/api/status");
  if (status !== 200) throw new Error(`status HTTP ${status}: ${body}`);
  return JSON.parse(body) as Record<string, unknown>;
}

function fmtSlot(
  label: AgentId,
  reg: { workspacePath?: string } | null | undefined,
  task: string | null | undefined,
  armed: boolean
): string {
  const pathShort = reg?.workspacePath ? reg.workspacePath : "—";
  const taskShort = task ? "task set" : "no task";
  const mcp = armed ? "get_my_task: yes" : "get_my_task: pending";
  return `  Agent ${label}: ${reg ? "TAKEN" : "VACANT"}  |  ${taskShort}  |  ${mcp}\n    ${pathShort}`;
}

async function printBoard(): Promise<void> {
  try {
    const s = await fetchStatus();
    const reg = s.registrations as { A?: { workspacePath: string } | null; B?: { workspacePath: string } | null };
    const taskA = s.taskA as string | null;
    const taskB = s.taskB as string | null;
    const armedA = !!s.armedA;
    const armedB = !!s.armedB;
    const sessionReady = !!s.sessionReady;
    const mode = s.mode as string;

    console.log("");
    console.log("— Duo Agent —");
    console.log(`Mode: ${mode}   |   Both agents called get_my_task: ${sessionReady ? "YES" : "NO"}`);
    console.log(fmtSlot("A", reg?.A ?? null, taskA, armedA));
    console.log(fmtSlot("B", reg?.B ?? null, taskB, armedB));
    console.log("");
  } catch (e) {
    console.error("Could not reach the server on port", PORT, ". Start the server from the Duo Agent sidebar (Start server), then retry.");
    console.error(String(e));
  }
}

async function setTask(agent: AgentId, task: string): Promise<void> {
  const { status, body } = await httpPost("/api/task", {
    agent_id: agent,
    task,
    mode: currentMode,
  });
  if (status !== 200) {
    console.error("Failed to set task:", body);
    return;
  }
  const st = await fetchStatus();
  const ws =
    agent === "A"
      ? (st.workspaceA as string | null)
      : (st.workspaceB as string | null);
  if (ws) {
    try {
      writeTaskFilesToDisk(ws, agent, task, currentMode);
      console.log(`TASKS.md updated for Agent ${agent} at ${ws}`);
    } catch (err) {
      console.error("Task saved on server but could not write TASKS.md:", String(err));
    }
  }
  console.log(`Task set for Agent ${agent}.`);
}

async function setArmed(agent: AgentId | "both", value: boolean): Promise<void> {
  const { status, body } = await httpPost("/api/arm", {
    agent_id: agent === "both" ? "both" : agent,
    armed: value,
  });
  const parsed = JSON.parse(body || "{}") as { error?: string; armed?: Record<AgentId, boolean> };
  if (status !== 200) {
    console.error(parsed.error ?? body);
    return;
  }
  console.log("Armed state:", parsed.armed);
}

function printHelp(): void {
  console.log(`
Commands (server on ${PORT} must be running — start it from the Duo Agent sidebar):
  config              Print MCP ~/.cursor/mcp.json snippet again
  status              Slots, tasks, whether each agent has called get_my_task yet
  mode auto-run       Next task uses auto-run (default)
  mode checkpoint     Next task uses checkpoint mode
  task A <text>       Set Agent A task (+ TASKS.md in that workspace)
  task B <text>       Set Agent B task
  disarm              Reset “who has called get_my_task” (operator only)
  watch on            Re-enable live board refresh over SSE (default)
  watch off           Stop SSE subscription (static terminal; type status manually)
  help                This help
  exit | quit         Exit

After tasks are set: each Cursor window opens Agent chat and uses the duo-agent
MCP tool get_my_task. The first call from each side counts as “started”.
When both have called once, get_my_task returns the full task (poll until not waiting).
`);
}

async function handleLine(line: string): Promise<boolean> {
  const trimmed = line.trim();
  if (!trimmed) return true;

  const lower = trimmed.toLowerCase();
  if (lower === "exit" || lower === "quit") return false;

  if (lower === "help" || lower === "?") {
    printHelp();
    return true;
  }

  if (lower === "config") {
    console.log(mcpConfigSnippet());
    return true;
  }

  if (lower === "status") {
    await printBoard();
    return true;
  }

  if (lower === "mode auto-run") {
    currentMode = "auto-run";
    console.log("Next task assignments will use: auto-run");
    return true;
  }

  if (lower === "mode checkpoint") {
    currentMode = "checkpoint";
    console.log("Next task assignments will use: checkpoint");
    return true;
  }

  if (lower === "disarm") {
    await setArmed("both", false);
    await printBoard();
    return true;
  }

  const taskMatch = /^task\s+([AB])\s+(.+)$/i.exec(trimmed);
  if (taskMatch) {
    await setTask(taskMatch[1].toUpperCase() as AgentId, taskMatch[2]);
    await printBoard();
    return true;
  }

  console.log("Unknown command. Type help.");
  return true;
}

async function main(): Promise<void> {
  printSessionBanner();
  await printBoard();

  let shuttingDown = false;
  let watchLive = true;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let sseReq: http.ClientRequest | null = null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  rl.setPrompt("duo> ");

  function stopSse(): void {
    if (sseReq) {
      sseReq.destroy();
      sseReq = null;
    }
  }

  async function refreshBoardAndPrompt(): Promise<void> {
    if (shuttingDown) return;
    try {
      rl.pause();
      await printBoard();
    } finally {
      rl.resume();
      rl.prompt(true);
    }
  }

  function scheduleBoardRefresh(): void {
    if (!watchLive || shuttingDown) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshBoardAndPrompt();
    }, 350);
  }

  function startSseWatch(): void {
    stopSse();
    if (!watchLive || shuttingDown) return;

    const req = http.get(`http://${HOST}:${PORT}/api/updates`, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        if (!shuttingDown && watchLive) setTimeout(startSseWatch, 3000);
        return;
      }

      let buffer = "";
      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(6)) as { type?: string };
            if (event.type === "registration" || event.type === "status") {
              scheduleBoardRefresh();
            }
          } catch {
            /* ignore malformed chunks */
          }
        }
      });

      res.on("end", () => {
        sseReq = null;
        if (!shuttingDown && watchLive) setTimeout(startSseWatch, 2000);
      });
    });

    req.on("error", () => {
      sseReq = null;
      if (!shuttingDown && watchLive) setTimeout(startSseWatch, 3000);
    });

    sseReq = req;
  }

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (lower === "watch off") {
      watchLive = false;
      stopSse();
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      console.log("Live board updates (SSE) disabled. Type watch on to re-enable, or status for a snapshot.\n");
      rl.prompt();
      return;
    }

    if (lower === "watch on") {
      watchLive = true;
      startSseWatch();
      console.log("Live board updates (SSE) enabled.\n");
      rl.prompt();
      return;
    }

    let continueLoop = true;
    try {
      continueLoop = await handleLine(line);
    } catch (e) {
      console.error(String(e));
    }

    if (!continueLoop) {
      shuttingDown = true;
      stopSse();
      if (refreshTimer) clearTimeout(refreshTimer);
      rl.close();
      return;
    }
    rl.prompt();
  });

  rl.on("close", () => {
    shuttingDown = true;
    stopSse();
    if (refreshTimer) clearTimeout(refreshTimer);
    process.exit(0);
  });

  rl.prompt();
  startSseWatch();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

/** REST control surface + SSE event stream — the CLI's and dashboard's API.
 *  Not MCP. Everything here is a thin, validated pass-through to the SessionStore.
 */
import type { IncomingMessage, ServerResponse } from "http";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { historyDir, loadConfig, saveConfig, type DuoConfig, type HubEvent } from "@duo/shared";
import { getAdapter, hasAdapter } from "@duo/adapters";
import type { PlanApprovalEdits, SessionStore, CreateSessionInput } from "./store.js";
import type { SessionSupervisor, StartOptions } from "./supervisor.js";

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export class RestApi {
  private subscribers = new Set<ServerResponse>();

  constructor(
    private store: SessionStore,
    private port: number,
    private supervisor: SessionSupervisor,
    private hubUrl: string
  ) {
    store.events.on("hub-event", (event: HubEvent) => this.broadcast(event));
  }

  private broadcast(event: HubEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const sub of this.subscribers) {
      if (sub.destroyed) {
        this.subscribers.delete(sub);
        continue;
      }
      try {
        sub.write(data);
      } catch {
        this.subscribers.delete(sub);
      }
    }
  }

  closeAll(): void {
    for (const res of this.subscribers) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    this.subscribers.clear();
  }

  /** Returns true if the request was handled. */
  async handle(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean> {
    const method = req.method ?? "GET";

    if (method === "GET" && urlPath === "/health") {
      json(res, 200, { ok: true, port: this.port, phase: this.store.getState().phase });
      return true;
    }

    if (method === "GET" && urlPath === "/api/status") {
      json(res, 200, this.store.getStatus());
      return true;
    }

    if (method === "GET" && urlPath === "/api/contracts") {
      json(res, 200, this.store.getContracts());
      return true;
    }

    if (method === "GET" && urlPath === "/api/board") {
      json(res, 200, {
        ...(this.store.getBoard() as object),
        proposedBoard: this.store.getState().proposedBoard,
        plan: this.store.planStatus(),
      });
      return true;
    }

    if (method === "POST" && urlPath === "/api/session") {
      const body = await readJson(req);
      const result = this.store.createSession(body as unknown as CreateSessionInput);
      json(res, "error" in result ? 409 : 200, result);
      return true;
    }

    if (method === "POST" && urlPath === "/api/plan/approve") {
      const body = await readJson(req);
      const result = this.store.approvePlan((body.edits ?? body) as PlanApprovalEdits);
      json(res, "error" in result ? 409 : 200, result);
      return true;
    }

    if (method === "POST" && urlPath === "/api/plan/feedback") {
      const body = await readJson(req);
      const result = this.store.planFeedback(String(body.message ?? ""));
      json(res, "error" in result ? 409 : 200, result);
      return true;
    }

    if (method === "POST" && urlPath === "/api/checkpoint/resolve") {
      const body = await readJson(req);
      const result = this.store.resolveCheckpoint(
        String(body.agent_id ?? ""),
        body.approved !== false,
        body.feedback === undefined ? undefined : String(body.feedback)
      );
      json(res, "error" in result ? 409 : 200, result);
      return true;
    }

    if (method === "POST" && urlPath === "/api/board/out-of-scope") {
      const body = await readJson(req);
      const ids = Array.isArray(body.task_ids) ? body.task_ids.map(String) : [];
      const result = this.store.markOutOfScope(ids);
      json(res, "error" in result ? 409 : 200, result);
      return true;
    }

    if (method === "POST" && urlPath === "/api/log") {
      // Control-plane log ingest: adapters pipe agent stdout here so hub logs stay
      // the single source of truth (CLI watch + dashboard both read them).
      const body = await readJson(req);
      const result = this.store.postUpdate(
        String(body.agent_id ?? "system"),
        String(body.message ?? ""),
        Array.isArray(body.refs) ? body.refs.map(String) : undefined
      );
      json(res, "error" in result ? 409 : 200, result);
      return true;
    }

    if (method === "POST" && urlPath === "/api/agent/release") {
      const body = await readJson(req);
      json(res, 200, this.store.releaseAgent(String(body.agent_id ?? "")));
      return true;
    }

    // ── Session lifecycle (hub-owned agents, phase 6) ──────────────────────────
    if (method === "POST" && urlPath === "/api/session/start") {
      const body = await readJson(req);
      const config = loadConfig();
      if (!config || config.agents.length === 0) {
        json(res, 409, { ok: false, error: "No configuration. Run `duo init` (or PUT /api/config)." });
        return true;
      }
      if (body.mode === "checkpoint" || body.mode === "auto-run") config.mode = body.mode;
      const opts: StartOptions = {
        goal: String(body.goal ?? "").trim(),
        plan: body.plan !== false,
        autoApproveTrivial: body.autoApproveTrivial !== false,
        registrationTimeoutMs: body.registrationTimeoutMs === undefined ? undefined : Number(body.registrationTimeoutMs),
      };
      if (!opts.goal) {
        json(res, 400, { ok: false, error: "A goal is required." });
        return true;
      }
      const result = await this.supervisor.start(config, this.hubUrl, opts);
      json(res, result.ok ? 200 : 409, result);
      return true;
    }

    if (method === "POST" && urlPath === "/api/session/stop") {
      await this.supervisor.stopAgents();
      const archive = this.store.stopSession(historyDir());
      json(res, 200, { ok: true, archive });
      return true;
    }

    if (method === "POST" && urlPath === "/api/session/resume") {
      const body = await readJson(req);
      const result = await this.supervisor.resume(String(body.agent_id ?? ""));
      json(res, result.ok ? 200 : 409, result);
      return true;
    }

    // ── Config (GUI-editable duo init data) ────────────────────────────────────
    if (method === "GET" && urlPath === "/api/config") {
      json(res, 200, { config: loadConfig() });
      return true;
    }
    if (method === "PUT" && urlPath === "/api/config") {
      const body = await readJson(req);
      const err = validateConfig(body);
      if (err) {
        json(res, 400, { ok: false, error: err });
        return true;
      }
      saveConfig(body as unknown as DuoConfig);
      json(res, 200, { ok: true });
      return true;
    }

    // ── Setup support for GUIs (folder picker, runner detection) ───────────────
    if (method === "GET" && urlPath === "/api/fs/list") {
      const url = new URL(req.url ?? "", "http://localhost");
      json(res, 200, listDir(url.searchParams.get("path")));
      return true;
    }
    if (method === "GET" && urlPath === "/api/runners/detect") {
      json(res, 200, { runners: await detectRunners() });
      return true;
    }
    if (method === "GET" && urlPath === "/api/runners/models") {
      const url = new URL(req.url ?? "", "http://localhost");
      json(res, 200, { models: listModels(url.searchParams.get("runner") ?? "") });
      return true;
    }

    // Back-compat alias.
    if (method === "POST" && urlPath === "/api/stop") {
      await this.supervisor.stopAgents();
      const archive = this.store.stopSession(historyDir());
      json(res, 200, { ok: true, archive });
      return true;
    }

    if (method === "GET" && urlPath === "/api/updates") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": keepalive\n\n");
      // Sync the connecting client immediately.
      res.write(`data: ${JSON.stringify({ type: "status", data: this.store.getStatus() })}\n\n`);
      this.subscribers.add(res);
      req.on("close", () => this.subscribers.delete(res));
      return true;
    }

    return false;
  }
}

// ── Setup-support helpers ────────────────────────────────────────────────────

const RUNNERS = ["claude-code", "cursor-cli", "cursor-ide"] as const;

function validateConfig(body: Record<string, unknown>): string | null {
  const agents = body.agents;
  if (!Array.isArray(agents) || agents.length < 2) return "config needs at least 2 agents";
  for (const a of agents as Array<Record<string, unknown>>) {
    if (!a.id || !a.workspace || !a.runner || !a.role) return "each agent needs id, workspace, runner, role";
    if (!RUNNERS.includes(a.runner as never)) return `unknown runner "${String(a.runner)}"`;
  }
  return null;
}

/** Directory listing for GUI folder pickers — sandboxed to $HOME, traversal-safe. */
function listDir(rawPath: string | null): { path: string; parent: string | null; dirs: string[]; error?: string } {
  const home = os.homedir();
  const target = path.resolve(rawPath && rawPath.trim() ? rawPath : home);
  // Reject anything outside home (the sandbox).
  if (target !== home && !target.startsWith(home + path.sep)) {
    return { path: home, parent: null, dirs: safeDirs(home), error: "outside home; reset to home" };
  }
  const parent = target === home ? null : path.dirname(target);
  return { path: target, parent, dirs: safeDirs(target) };
}

function safeDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort()
      .slice(0, 500);
  } catch {
    return [];
  }
}

/** Models offered per runner. "" (default) is always first — let the runner pick. */
function listModels(runner: string): Array<{ id: string; label: string }> {
  const defaultOpt = { id: "", label: "Default" };
  if (runner === "claude-code") {
    return [
      defaultOpt,
      { id: "opus", label: "Claude Opus (most capable)" },
      { id: "sonnet", label: "Claude Sonnet (balanced)" },
      { id: "haiku", label: "Claude Haiku (fast)" },
    ];
  }
  if (runner === "cursor-cli") {
    try {
      const r = spawnSync(process.env.DUO_CURSOR_BIN ?? "cursor-agent", ["--list-models"], {
        encoding: "utf8",
        timeout: 15_000,
      });
      const models = `${r.stdout ?? ""}`
        .split("\n")
        .map((l) => l.match(/^(\S+)\s+-\s+(.+)$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({ id: m[1], label: m[2] }));
      return models.length ? [defaultOpt, ...models] : [defaultOpt];
    } catch {
      return [defaultOpt];
    }
  }
  return [defaultOpt];
}

async function detectRunners(): Promise<Array<{ runner: string; ok: boolean; version?: string; reason?: string }>> {
  const out = [];
  for (const runner of RUNNERS) {
    if (!hasAdapter(runner)) {
      out.push({ runner, ok: false, reason: "no adapter" });
      continue;
    }
    const r = await getAdapter(runner).detect();
    out.push({ runner, ok: r.ok, version: r.version, reason: r.reason });
  }
  return out;
}

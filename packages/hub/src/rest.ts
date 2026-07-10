/** REST control surface + SSE event stream — the CLI's and dashboard's API.
 *  Not MCP. Everything here is a thin, validated pass-through to the SessionStore.
 */
import type { IncomingMessage, ServerResponse } from "http";
import { historyDir, type HubEvent } from "@duo/shared";
import type { PlanApprovalEdits, SessionStore, CreateSessionInput } from "./store.js";

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

  constructor(private store: SessionStore, private port: number) {
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

    if (method === "POST" && urlPath === "/api/stop") {
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

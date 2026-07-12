/** Thin REST + SSE client for the hub. Every command except init/start is a client of this. */
import type { HubEvent } from "@duo/shared";

export class HubClient {
  constructor(private baseUrl: string) {}

  private async req(method: string, pathname: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: res.ok, raw: text };
    }
  }

  get(pathname: string) {
    return this.req("GET", pathname);
  }
  post(pathname: string, body?: unknown) {
    return this.req("POST", pathname, body);
  }

  health() {
    return this.get("/health");
  }
  status() {
    return this.get("/api/status");
  }
  board() {
    return this.get("/api/board");
  }
  createSession(body: unknown) {
    return this.post("/api/session", body);
  }
  startSession(body: { goal: string; plan: boolean; mode?: string }) {
    return this.post("/api/session/start", body);
  }
  stopSession() {
    return this.post("/api/session/stop", {});
  }
  resumeAgent(agentId: string) {
    return this.post("/api/session/resume", { agent_id: agentId });
  }
  getConfig() {
    return this.get("/api/config");
  }
  detectRunners() {
    return this.get("/api/runners/detect");
  }
  approvePlan(edits: unknown) {
    return this.post("/api/plan/approve", edits);
  }
  planFeedback(message: string) {
    return this.post("/api/plan/feedback", { message });
  }
  resolveCheckpoint(agentId: string, approved: boolean, feedback?: string) {
    return this.post("/api/checkpoint/resolve", { agent_id: agentId, approved, feedback });
  }
  markOutOfScope(taskIds: string[]) {
    return this.post("/api/board/out-of-scope", { task_ids: taskIds });
  }
  releaseAgent(agentId: string) {
    return this.post("/api/agent/release", { agent_id: agentId });
  }
  log(agentId: string, message: string) {
    return this.post("/api/log", { agent_id: agentId, message });
  }
  stop() {
    return this.post("/api/stop", {});
  }

  /** Subscribe to the SSE event stream. Returns a stop function. */
  async subscribe(onEvent: (event: HubEvent) => void): Promise<() => void> {
    const abort = new AbortController();
    const res = await fetch(`${this.baseUrl}/api/updates`, {
      headers: { Accept: "text/event-stream" },
      signal: abort.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    void (async () => {
      for (;;) {
        const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
          if (data) {
            try {
              onEvent(JSON.parse(data) as HubEvent);
            } catch {
              /* keepalive */
            }
          }
        }
      }
    })();

    return () => abort.abort();
  }
}

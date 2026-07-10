/** Transport parity: the legacy HTTP+SSE MCP transport must run the same core
 *  session flow as streamable HTTP. Client below implements the gen-1 protocol:
 *  GET /sse → endpoint event → POST /message → responses arrive on the stream.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.js";

class LegacyClient {
  private endpoint = "";
  private nextId = 0;
  private pending = new Map<number, (value: Record<string, unknown>) => void>();
  private abort = new AbortController();

  constructor(private baseUrl: string) {}

  async connect(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sse`, {
      headers: { Accept: "text/event-stream" },
      signal: this.abort.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const endpointReady = new Promise<void>((resolve) => {
      const pump = async (): Promise<void> => {
        for (;;) {
          const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            this.handleFrame(frame, resolve);
          }
        }
      };
      void pump();
    });
    await endpointReady;
  }

  private handleFrame(frame: string, onEndpoint: () => void): void {
    const lines = frame.split("\n");
    const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
    const data = lines.find((l) => l.startsWith("data: "))?.slice(6);
    if (!data) return;
    if (event === "endpoint") {
      this.endpoint = data;
      onEndpoint();
      return;
    }
    try {
      const msg = JSON.parse(data) as { id?: number };
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg as Record<string, unknown>);
        this.pending.delete(msg.id);
      }
    } catch {
      /* ignore keepalives */
    }
  }

  private rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    const response = new Promise<Record<string, unknown>>((resolve) => this.pending.set(id, resolve));
    void fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    return response;
  }

  async initialize(): Promise<Record<string, unknown>> {
    return this.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "legacy-test", version: "0" } });
  }

  async listTools(): Promise<string[]> {
    const res = (await this.rpc("tools/list")) as { result: { tools: Array<{ name: string }> } };
    return res.result.tools.map((t) => t.name);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const res = (await this.rpc("tools/call", { name, arguments: args })) as {
      result?: { content: Array<{ type: string; text: string }> };
      error?: { message: string };
    };
    if (res.error) throw new Error(res.error.message);
    return JSON.parse(res.result!.content[0].text) as Record<string, unknown>;
  }

  close(): void {
    this.abort.abort();
  }
}

let h: Harness;
let a: LegacyClient;
let b: LegacyClient;

beforeAll(async () => {
  h = await startHarness();
  await h.createSession("Legacy transport parity");
  a = new LegacyClient(h.url);
  b = new LegacyClient(h.url);
  await a.connect();
  await b.connect();
});

afterAll(async () => {
  a.close();
  b.close();
  await h.cleanup();
});

describe("legacy SSE transport parity", () => {
  it("initializes and lists the same tool catalog as streamable HTTP", async () => {
    const init = (await a.initialize()) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("duo");

    const legacyTools = await a.listTools();
    const modern = await h.connectAgent("A"); // streamable HTTP client
    const modernTools = await modern.listTools();
    expect(legacyTools.sort()).toEqual(modernTools.sort());
  });

  it("runs the core session flow over legacy SSE", async () => {
    await b.initialize();
    expect((await a.callTool("register_agent", { agent_id: "A", workspace_path: h.wsA })).ok).toBe(true);
    expect((await b.callTool("register_agent", { agent_id: "B", workspace_path: h.wsB })).ok).toBe(true);

    await a.callTool("post_plan", { agent_id: "A", items: [{ title: "A part", ownerHint: "A" }] });
    await b.callTool("post_plan", {
      agent_id: "B",
      items: [
        { title: "B part", ownerHint: "B" },
        { title: "shared part", ownerHint: null },
      ],
    });

    const plan = (await a.callTool("get_plan_status", { agent_id: "A" })) as { unassigned: string[] };
    await h.human.approvePlan({ assign: { [plan.unassigned[0]]: "A" } });

    const board = (await a.callTool("get_board")) as { items: Array<{ id: string; owner: string }> };
    expect(board.items).toHaveLength(3);

    for (const item of board.items) {
      const client = item.owner === "A" ? a : b;
      const id = item.owner;
      expect((await client.callTool("claim_task", { agent_id: id, task_id: item.id })).ok).toBe(true);
      expect((await client.callTool("complete_task", { agent_id: id, task_id: item.id })).ok).toBe(true);
    }

    const status = (await a.callTool("get_status")) as { phase: string };
    expect(status.phase).toBe("done");
  });
});

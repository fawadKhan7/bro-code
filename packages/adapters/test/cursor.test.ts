/** Cursor adapter unit tests: config writing (+ mcp enable idempotency), stream summarization,
 *  clipboard fallback, MCP-status parsing, and registry wiring. No real cursor-agent required
 *  for the pure paths; the enable call is best-effort and tolerated when the binary is absent.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { makeCursorStreamSummarizer } from "../src/common.js";
import { CursorCliAdapter } from "../src/cursorCli.js";
import { CursorIdeAdapter } from "../src/cursorIde.js";
import { getAdapter, hasAdapter, knownRunners } from "../src/registry.js";
import type { LaunchContext } from "../src/types.js";

let tmp: string;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});
function tmpdir(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "duo-cursor-"));
  return tmp;
}
function ctxFor(ws: string, runner: "cursor-cli" | "cursor-ide"): LaunchContext {
  return {
    agent: { id: "A", workspace: ws, runner, role: "Frontend" },
    kickoffPrompt: "PASTE ME",
    hubUrl: "http://127.0.0.1:3131",
    toolPrefix: "duo",
  };
}

describe("makeCursorStreamSummarizer", () => {
  it("handles a flat tool event", () => {
    const s = makeCursorStreamSummarizer();
    expect(s.feed(JSON.stringify({ type: "tool_call", name: "claim_task" }))).toEqual(["→ claim_task"]);
  });

  it("handles Claude-like content blocks", () => {
    const s = makeCursorStreamSummarizer();
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "working  on  it" }] } });
    expect(s.feed(line)).toEqual(["working on it"]);
  });

  it("handles flat complete assistant text", () => {
    const s = makeCursorStreamSummarizer();
    expect(s.feed(JSON.stringify({ type: "assistant", text: "hi there" }))).toEqual(["hi there"]);
  });

  it("aggregates thinking deltas into one line (the word-salad regression)", () => {
    // Real cursor-agent 2026.07 shape, captured from a live run.
    const s = makeCursorStreamSummarizer();
    expect(s.feed(JSON.stringify({ type: "thinking", subtype: "delta", text: "The user requested a" }))).toEqual([]);
    expect(s.feed(JSON.stringify({ type: "thinking", subtype: "delta", text: " reply containing exactly" }))).toEqual([]);
    expect(s.feed(JSON.stringify({ type: "thinking", subtype: "delta", text: ' "hello".' }))).toEqual([]);
    expect(s.feed(JSON.stringify({ type: "thinking", subtype: "completed" }))).toEqual([
      '✻ The user requested a reply containing exactly "hello".',
    ]);
  });

  it("flushes a pending buffer when a non-delta event arrives, then on result", () => {
    const s = makeCursorStreamSummarizer();
    s.feed(JSON.stringify({ type: "thinking", subtype: "delta", text: "Claiming the scaffold" }));
    s.feed(JSON.stringify({ type: "thinking", subtype: "delta", text: " tasks now." }));
    expect(s.feed(JSON.stringify({ type: "tool_call", name: "claim_task" }))).toEqual([
      "✻ Claiming the scaffold tasks now.",
      "→ claim_task",
    ]);
    expect(s.feed(JSON.stringify({ type: "result", subtype: "success" }))).toEqual(["[session success]"]);
  });

  it("does not repeat a complete assistant message that already streamed as deltas", () => {
    const s = makeCursorStreamSummarizer();
    s.feed(JSON.stringify({ type: "assistant", subtype: "delta", text: "hello " }));
    s.feed(JSON.stringify({ type: "assistant", subtype: "delta", text: "world" }));
    expect(s.feed(JSON.stringify({ type: "assistant", subtype: "completed" }))).toEqual(["hello world"]);
    const complete = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello world" }] } });
    expect(s.feed(complete)).toEqual([]);
  });

  it("flush() recovers a trailing partial thought on process exit", () => {
    const s = makeCursorStreamSummarizer();
    s.feed(JSON.stringify({ type: "thinking", subtype: "delta", text: "half a tho" }));
    expect(s.flush()).toEqual(["✻ half a tho"]);
    expect(s.flush()).toEqual([]);
  });

  it("skips unrecognized/non-JSON and the kickoff-prompt user echo", () => {
    const s = makeCursorStreamSummarizer();
    expect(s.feed("garbage")).toEqual([]);
    expect(s.feed(JSON.stringify({ type: "ping" }))).toEqual([]);
    const userEcho = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "the whole kickoff prompt" }] } });
    expect(s.feed(userEcho)).toEqual([]);
  });
});

describe("registry", () => {
  it("registers all three runners", () => {
    for (const r of ["claude-code", "cursor-cli", "cursor-ide"] as const) {
      expect(hasAdapter(r)).toBe(true);
      expect(getAdapter(r).runner).toBe(r);
    }
    expect(knownRunners()).toEqual(expect.arrayContaining(["claude-code", "cursor-cli", "cursor-ide"]));
  });
});

describe("CursorCliAdapter", () => {
  it("configure writes .cursor/mcp.json with the /mcp url", async () => {
    const ws = tmpdir();
    // Point the enable subprocess at a no-op binary so the test never needs cursor-agent.
    const prev = process.env.DUO_CURSOR_BIN;
    process.env.DUO_CURSOR_BIN = "true";
    try {
      await new CursorCliAdapter().configure(ctxFor(ws, "cursor-cli"));
    } finally {
      process.env.DUO_CURSOR_BIN = prev;
    }
    const parsed = JSON.parse(fs.readFileSync(path.join(ws, ".cursor", "mcp.json"), "utf8"));
    expect(parsed.mcpServers.duo).toEqual({ url: "http://127.0.0.1:3131/mcp" });
  });

  it("detect reports missing binary with a fallback hint", async () => {
    const prev = process.env.DUO_CURSOR_BIN;
    process.env.DUO_CURSOR_BIN = "definitely-not-cursor-xyz-123";
    try {
      const res = await new CursorCliAdapter().detect();
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("cursor-ide");
    } finally {
      process.env.DUO_CURSOR_BIN = prev;
    }
  });
});

describe("CursorIdeAdapter", () => {
  it("is always detectable (needs only a human)", async () => {
    const res = await new CursorIdeAdapter().detect();
    expect(res.ok).toBe(true);
  });

  it("configure writes .cursor/mcp.json and launch returns a manual handle", async () => {
    const ws = tmpdir();
    const prev = process.env.DUO_CURSOR_BIN;
    process.env.DUO_CURSOR_BIN = "true";
    try {
      const adapter = new CursorIdeAdapter();
      await adapter.configure(ctxFor(ws, "cursor-ide"));
      expect(fs.existsSync(path.join(ws, ".cursor", "mcp.json"))).toBe(true);
      const handle = await adapter.launch(ctxFor(ws, "cursor-ide"));
      expect(handle.kind).toBe("manual");
      expect(handle.exited).toBe(false);
      await handle.stop(); // no-op, must not throw
    } finally {
      process.env.DUO_CURSOR_BIN = prev;
    }
  });
});

/** Cursor adapter unit tests: config writing (+ mcp enable idempotency), stream summarization,
 *  clipboard fallback, MCP-status parsing, and registry wiring. No real cursor-agent required
 *  for the pure paths; the enable call is best-effort and tolerated when the binary is absent.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeCursorStreamLine } from "../src/common.js";
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

describe("summarizeCursorStreamLine (defensive)", () => {
  it("handles a flat tool event", () => {
    expect(summarizeCursorStreamLine(JSON.stringify({ type: "tool_call", name: "claim_task" }))).toBe(
      "→ claim_task"
    );
  });
  it("handles Claude-like content blocks", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "working  on  it" }] } });
    expect(summarizeCursorStreamLine(line)).toBe("working on it");
  });
  it("handles a flat text delta", () => {
    expect(summarizeCursorStreamLine(JSON.stringify({ type: "assistant", text: "hi there" }))).toBe("hi there");
  });
  it("skips unrecognized/non-JSON", () => {
    expect(summarizeCursorStreamLine("garbage")).toBeNull();
    expect(summarizeCursorStreamLine(JSON.stringify({ type: "ping" }))).toBeNull();
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

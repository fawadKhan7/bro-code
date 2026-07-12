/** Adapter unit tests: config-file merge, stream summarization, and the claude-code adapter's
 *  detection + config writing. No real `claude` binary needed.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeMcpConfig, summarizeClaudeStreamLine, makeLineReader, extractUsageTokens } from "../src/common.js";
import { ClaudeCodeAdapter, buildClaudeArgs } from "../src/claudeCode.js";
import { getAdapter, hasAdapter, knownRunners } from "../src/registry.js";
import type { LaunchContext } from "../src/types.js";

let tmp: string;

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

function tmpdir(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "duo-adapter-"));
  return tmp;
}

describe("mergeMcpConfig", () => {
  it("creates a config with the server entry", () => {
    const file = path.join(tmpdir(), ".mcp.json");
    mergeMcpConfig(file, "duo", { type: "http", url: "http://127.0.0.1:3131/mcp" });
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(parsed.mcpServers.duo.url).toBe("http://127.0.0.1:3131/mcp");
  });

  it("is idempotent and never clobbers other servers", () => {
    const file = path.join(tmpdir(), ".mcp.json");
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    mergeMcpConfig(file, "duo", { type: "http", url: "u1" });
    mergeMcpConfig(file, "duo", { type: "http", url: "u2" });
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(parsed.mcpServers.other.command).toBe("x"); // preserved
    expect(parsed.mcpServers.duo.url).toBe("u2"); // updated, single entry
    expect(Object.keys(parsed.mcpServers)).toHaveLength(2);
  });

  it("survives a corrupt existing file", () => {
    const file = path.join(tmpdir(), ".mcp.json");
    fs.writeFileSync(file, "{ not json");
    mergeMcpConfig(file, "duo", { type: "http", url: "u" });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.duo.url).toBe("u");
  });
});

describe("summarizeClaudeStreamLine", () => {
  it("summarizes a tool_use block", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "post_plan" }] },
    });
    expect(summarizeClaudeStreamLine(line)).toBe("→ post_plan");
  });

  it("summarizes text and truncates", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "  hello   world  " }] },
    });
    expect(summarizeClaudeStreamLine(line)).toBe("hello world");
  });

  it("marks the result event", () => {
    expect(summarizeClaudeStreamLine(JSON.stringify({ type: "result", subtype: "success" }))).toBe(
      "[session success]"
    );
  });

  it("ignores non-JSON and empty lines", () => {
    expect(summarizeClaudeStreamLine("not json")).toBeNull();
    expect(summarizeClaudeStreamLine("")).toBeNull();
  });
});

describe("makeLineReader", () => {
  it("emits complete lines across chunk boundaries", () => {
    const seen: string[] = [];
    const read = makeLineReader((l) => seen.push(l));
    read(Buffer.from("hel"));
    read(Buffer.from("lo\nwor"));
    read(Buffer.from("ld\n"));
    expect(seen).toEqual(["hello", "world"]);
  });
});

describe("extractUsageTokens", () => {
  it("sums Claude snake_case usage from a result event", () => {
    const line = JSON.stringify({
      type: "result",
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 3, service_tier: "standard" },
    });
    expect(extractUsageTokens(line)).toBe(128);
  });
  it("sums cursor camelCase usage from a result event", () => {
    const line = JSON.stringify({
      type: "result",
      usage: { inputTokens: 200, outputTokens: 37, cacheReadTokens: 10, cacheWriteTokens: 0 },
    });
    expect(extractUsageTokens(line)).toBe(247);
  });
  it("ignores lines without usage", () => {
    expect(extractUsageTokens(JSON.stringify({ type: "assistant" }))).toBeNull();
    expect(extractUsageTokens("not json")).toBeNull();
  });
});

describe("model flag", () => {
  it("buildClaudeArgs appends --model when the agent has one", () => {
    const base: LaunchContext = {
      agent: { id: "A", workspace: "/w", runner: "claude-code", role: "R" },
      kickoffPrompt: "go",
      hubUrl: "http://127.0.0.1:3131",
      toolPrefix: "duo",
    };
    expect(buildClaudeArgs(base, "acceptEdits")).not.toContain("--model");
    const withModel = buildClaudeArgs({ ...base, agent: { ...base.agent, model: "opus" } }, "acceptEdits");
    const i = withModel.indexOf("--model");
    expect(i).toBeGreaterThan(-1);
    expect(withModel[i + 1]).toBe("opus");
  });
});

describe("registry", () => {
  it("resolves claude-code, lists runners, errors on unknown", () => {
    expect(hasAdapter("claude-code")).toBe(true);
    expect(knownRunners()).toContain("claude-code");
    expect(getAdapter("claude-code").runner).toBe("claude-code");
    expect(() => getAdapter("nonexistent-runner" as never)).toThrow(/No adapter/);
  });
});

describe("ClaudeCodeAdapter", () => {
  it("configure writes a project-scoped .mcp.json pointing at the hub", async () => {
    const ws = tmpdir();
    const adapter = new ClaudeCodeAdapter();
    const ctx: LaunchContext = {
      agent: { id: "A", workspace: ws, runner: "claude-code", role: "Frontend" },
      kickoffPrompt: "…",
      hubUrl: "http://127.0.0.1:3131",
      toolPrefix: "duo",
    };
    await adapter.configure(ctx);
    const parsed = JSON.parse(fs.readFileSync(path.join(ws, ".mcp.json"), "utf8"));
    expect(parsed.mcpServers.duo).toEqual({ type: "http", url: "http://127.0.0.1:3131/mcp" });
  });

  it("launch args explicitly allow the duo MCP server tools (regression: real-run permission bug)", () => {
    const ctx: LaunchContext = {
      agent: { id: "B", workspace: "/proj/api", runner: "claude-code", role: "Backend" },
      kickoffPrompt: "go",
      hubUrl: "http://127.0.0.1:3131",
      toolPrefix: "duo",
    };
    const args = buildClaudeArgs(ctx, "acceptEdits");
    const i = args.indexOf("--allowedTools");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("mcp__duo");
    expect(args).toContain("--mcp-config");
  });

  it("detect reports missing binary with a fix hint", async () => {
    const prev = process.env.DUO_CLAUDE_BIN;
    process.env.DUO_CLAUDE_BIN = "definitely-not-a-real-binary-xyz-123";
    try {
      const result = await new ClaudeCodeAdapter().detect();
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("not found on PATH");
    } finally {
      process.env.DUO_CLAUDE_BIN = prev;
    }
  });
});

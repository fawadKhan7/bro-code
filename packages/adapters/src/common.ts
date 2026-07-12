/** Shared adapter utilities: MCP config merge-write, stream-json parsing, binary detection.
 *  Behavior implemented once here is inherited by every adapter.
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/** Idempotently merge one MCP server entry into a JSON config file, never clobbering others. */
export function mergeMcpConfig(
  filePath: string,
  serverName: string,
  entry: Record<string, unknown>
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (fs.existsSync(filePath)) {
    try {
      config = JSON.parse(fs.readFileSync(filePath, "utf8")) as typeof config;
    } catch {
      config = {};
    }
  }
  config.mcpServers = { ...(config.mcpServers ?? {}), [serverName]: entry };
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
}

/** Check a binary is on PATH and grab its version line. */
export function detectBinary(bin: string, versionArgs: string[] = ["--version"]): {
  ok: boolean;
  version?: string;
} {
  try {
    const res = spawnSync(bin, versionArgs, { encoding: "utf8", timeout: 10_000 });
    if (res.error || res.status !== 0) return { ok: false };
    const version = (res.stdout || res.stderr || "").trim().split("\n")[0];
    return { ok: true, version };
  } catch {
    return { ok: false };
  }
}

/** Parse one line of Claude Code stream-json output into a short human log line, or null to skip. */
export function summarizeClaudeStreamLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null; // non-JSON noise
  }

  const type = String(evt.type ?? "");
  if (type === "assistant" || type === "user") {
    const message = evt.message as { content?: Array<Record<string, unknown>> } | undefined;
    const blocks = message?.content ?? [];
    for (const block of blocks) {
      if (block.type === "tool_use") return `→ ${String(block.name ?? "tool")}`;
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim().replace(/\s+/g, " ");
        if (text) return text.slice(0, 200);
      }
    }
    return null;
  }
  if (type === "result") {
    const subtype = String(evt.subtype ?? "");
    return `[session ${subtype || "ended"}]`;
  }
  return null;
}

/** Summarize one line of cursor-agent stream-json into a short human log line, or null.
 *  Defensive: cursor's schema differs from Claude's and may shift between versions, so we probe
 *  a few common shapes and skip anything unrecognized (piping is best-effort — the real signal is
 *  the agent's MCP tool calls, which show up in hub logs regardless).
 */
export function summarizeCursorStreamLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = String(evt.type ?? "");
  // Tool-call shapes.
  if (type.includes("tool")) {
    const name = evt.name ?? (evt.tool as Record<string, unknown> | undefined)?.name ?? (evt.toolName as unknown);
    if (name) return `→ ${String(name)}`;
  }
  // Assistant message with content blocks (Claude-like).
  const message = evt.message as { content?: Array<Record<string, unknown>> } | undefined;
  const blocks = message?.content;
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (String(block.type ?? "").includes("tool") && block.name) return `→ ${String(block.name)}`;
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        return block.text.trim().replace(/\s+/g, " ").slice(0, 200);
      }
    }
  }
  // Flat text delta / assistant text.
  if (typeof evt.text === "string" && evt.text.trim()) {
    return evt.text.trim().replace(/\s+/g, " ").slice(0, 200);
  }
  if (type === "result") return `[session ${String(evt.subtype ?? "ended")}]`;
  return null;
}

export type CursorMcpStatus = "ready" | "needs-approval" | "connection-failed" | "absent" | "no-cli";

/** Model-free attachment probe: run `cursor-agent mcp list` in a workspace, report one server's
 *  status. Used by `duo doctor` to catch the print-mode approval quirk before a session starts. */
export function probeCursorMcp(workspace: string, serverName: string, bin?: string): CursorMcpStatus {
  const cursorBin = bin ?? process.env.DUO_CURSOR_BIN ?? "cursor-agent";
  let out: string;
  try {
    const res = spawnSync(cursorBin, ["mcp", "list"], { cwd: workspace, encoding: "utf8", timeout: 20_000 });
    if (res.error) return "no-cli";
    out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  } catch {
    return "no-cli";
  }
  const line = out.split("\n").find((l) => l.trim().startsWith(`${serverName}:`));
  if (!line) return "absent";
  const lower = line.toLowerCase();
  if (lower.includes("ready")) return "ready";
  if (lower.includes("approval")) return "needs-approval";
  if (lower.includes("error") || lower.includes("failed")) return "connection-failed";
  return "absent";
}

/** Copy text to the OS clipboard. Returns the tool used, or null if none available. */
export function copyToClipboard(text: string): string | null {
  const candidates: Array<{ bin: string; args: string[] }> =
    process.platform === "darwin"
      ? [{ bin: "pbcopy", args: [] }]
      : [
          { bin: "wl-copy", args: [] },
          { bin: "xclip", args: ["-selection", "clipboard"] },
          { bin: "xsel", args: ["--clipboard", "--input"] },
        ];
  for (const { bin, args } of candidates) {
    try {
      const res = spawnSync(bin, args, { input: text, timeout: 5000 });
      if (!res.error && res.status === 0) return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Extract a total token count from a stream-json `result` event's usage, or null.
 *  Handles both Claude (snake_case: input_tokens, cache_read_input_tokens…) and cursor-agent
 *  (camelCase: inputTokens, cacheReadTokens…) by summing every top-level numeric field whose key
 *  mentions "token". Verified against real output of both CLIs (2026-07).
 */
export function extractUsageTokens(line: string): number | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("usage")) return null;
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const usage = evt.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;
  let total = 0;
  let found = false;
  for (const [k, v] of Object.entries(usage)) {
    if (typeof v === "number" && /token/i.test(k)) {
      total += v;
      found = true;
    }
  }
  return found ? total : null;
}

/** Read stdout line-by-line, invoking onLine per complete line. Returns a flush function. */
export function makeLineReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString();
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      onLine(line);
    }
  };
}

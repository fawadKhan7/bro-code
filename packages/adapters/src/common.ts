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

/** Max characters of one activity log line; longer text is cut with an ellipsis. */
const LOG_LINE_MAX = 240;

function cleanText(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  return text.length > LOG_LINE_MAX ? text.slice(0, LOG_LINE_MAX - 1) + "…" : text;
}

/** Summarize the content blocks of one COMPLETE assistant message into log lines. */
function summarizeBlocks(blocks: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    const btype = String(block.type ?? "");
    if (btype.includes("tool") && !btype.includes("result")) {
      out.push(`→ ${String(block.name ?? "tool")}`);
    } else if (btype === "text" && typeof block.text === "string" && block.text.trim()) {
      out.push(cleanText(block.text));
    }
  }
  return out;
}

/** Parse one line of Claude Code stream-json output into human log lines ([] to skip).
 *  Only complete assistant messages are summarized — partial/delta events are never logged
 *  line-by-line (that turns the activity feed into word salad). */
export function summarizeClaudeStreamEvents(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return []; // non-JSON noise
  }

  const type = String(evt.type ?? "");
  if (type === "assistant") {
    const message = evt.message as { content?: Array<Record<string, unknown>> } | undefined;
    return summarizeBlocks(message?.content ?? []);
  }
  if (type === "result") {
    return [`[session ${String(evt.subtype ?? "") || "ended"}]`];
  }
  return [];
}

/** Back-compat single-line variant (first summary or null). */
export function summarizeClaudeStreamLine(line: string): string | null {
  return summarizeClaudeStreamEvents(line)[0] ?? null;
}

/** Stateful summarizer for cursor-agent stream-json.
 *
 *  cursor-agent streams thinking (and sometimes assistant text) word-by-word:
 *    {"type":"thinking","subtype":"delta","text":"The user requested a"}
 *    {"type":"thinking","subtype":"delta","text":" reply containing exactly"}
 *    {"type":"thinking","subtype":"completed"}
 *  Logging each delta made the activity feed one word per line. This factory buffers deltas and
 *  emits whole thoughts: flushed on the "completed" marker, on any other event, or past a size
 *  cap. Thinking lines are prefixed "✻ " so the dashboard can label them. Call flush() when the
 *  process exits so a trailing partial thought isn't lost.
 */
export function makeCursorStreamSummarizer(): {
  feed(line: string): string[];
  flush(): string[];
} {
  const BUFFER_FLUSH_AT = 400;
  let bufferKind: "thinking" | "text" | null = null;
  let buffer = "";
  let lastEmitted = "";

  const flush = (): string[] => {
    const kind = bufferKind;
    const text = buffer.trim().replace(/\s+/g, " ");
    buffer = "";
    bufferKind = null;
    if (!text) return [];
    const line = kind === "thinking" ? `✻ ${cleanText(text)}` : cleanText(text);
    lastEmitted = cleanText(text);
    return [line];
  };

  const feed = (line: string): string[] => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return [];
    }

    const type = String(evt.type ?? "");
    const subtype = String(evt.subtype ?? "");

    // Word-by-word deltas: accumulate, emit nothing yet.
    if (subtype === "delta" && typeof evt.text === "string") {
      const kind = type === "thinking" ? "thinking" : "text";
      const out = kind !== bufferKind && buffer ? flush() : [];
      bufferKind = kind;
      buffer += evt.text;
      if (buffer.length >= BUFFER_FLUSH_AT) out.push(...flush());
      return out;
    }
    // End of a streamed thought/message.
    if (subtype === "completed") return flush();

    // Any other event closes the open buffer first, then may add its own line.
    const out = flush();

    if (type.includes("tool")) {
      const name = evt.name ?? (evt.tool as Record<string, unknown> | undefined)?.name ?? (evt.toolName as unknown);
      if (name) out.push(`→ ${String(name)}`);
      return out;
    }
    if (type === "assistant") {
      const message = evt.message as { content?: Array<Record<string, unknown>> } | undefined;
      const blocks = message && Array.isArray(message.content) ? summarizeBlocks(message.content) : [];
      // A complete assistant message can repeat text we already streamed via deltas — skip dupes.
      out.push(...blocks.filter((b) => b !== lastEmitted));
      // Flat complete assistant text (older schema).
      if (!blocks.length && typeof evt.text === "string" && evt.text.trim()) {
        const text = cleanText(evt.text);
        if (text !== lastEmitted) out.push(text);
      }
      return out;
    }
    if (type === "result") {
      out.push(`[session ${subtype || "ended"}]`);
      return out;
    }
    // "system", "user" (kickoff echo / tool results), "ping" … — not activity, skip.
    return out;
  };

  return { feed, flush };
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

/** Pull the runner's session id from a stream-json line (Claude's system/init and result events
 *  carry `session_id`). The supervisor stores it so a later wake can resume the same AI session
 *  (claude --resume) and the agent remembers its earlier work. */
export function extractSessionId(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("session_id")) return null;
  try {
    const evt = JSON.parse(trimmed) as Record<string, unknown>;
    return typeof evt.session_id === "string" && evt.session_id ? evt.session_id : null;
  } catch {
    return null;
  }
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

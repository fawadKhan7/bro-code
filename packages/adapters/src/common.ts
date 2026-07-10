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

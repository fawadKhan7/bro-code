/** Contract disk mirror — ported from the Duo Agent extension (src/contractDisk.ts). */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** Slug: lowercase letters, digits, hyphens; max 64 chars. */
export function sanitizeServiceSlug(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!s) s = "contract";
  return s;
}

/** Parse `service: foo-bar` from first lines of content. */
export function parseServiceFromContent(content: string): string | undefined {
  const m = content.match(/^\s*service:\s*([^\s\r\n]+)/im);
  if (!m) return undefined;
  return sanitizeServiceSlug(m[1]);
}

export function resolveServiceSlug(content: string, explicit?: string): string {
  if (explicit?.trim()) return sanitizeServiceSlug(explicit.trim());
  const parsed = parseServiceFromContent(content);
  if (parsed) return parsed;
  const h = hashContent(content).slice(0, 8);
  return `general-${h}`;
}

export interface ContractDiskEntry {
  agentId: string;
  timestamp: string;
  contentHash: string;
  title?: string;
  revision: number;
  content: string;
}

/** Prepends a new revision block; older content kept below a horizontal rule. */
export function writeContractRevisionToDisk(
  workspaceRoot: string,
  slug: string,
  entry: ContractDiskEntry
): string {
  const dir = path.join(workspaceRoot, "contracts");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.md`);

  const titleLine = entry.title ? `**Title:** ${entry.title}\n` : "";
  const block =
    `<!-- duo contract revision — safe to commit after redacting secrets -->\n` +
    `## Revision ${entry.revision} — ${entry.timestamp}\n` +
    `**Agent:** ${entry.agentId}  \n` +
    titleLine +
    `**contentHash:** \`${entry.contentHash}\`\n\n` +
    `${entry.content.trim()}\n`;

  let body = block;
  if (fs.existsSync(filePath)) {
    const prev = fs.readFileSync(filePath, "utf8");
    body = `${block}\n\n---\n\n${prev}`;
  } else {
    body = `# Duo — contract: \`${slug}\`\n\n${block}`;
  }

  fs.writeFileSync(filePath, body, "utf8");
  return filePath;
}

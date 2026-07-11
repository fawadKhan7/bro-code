#!/usr/bin/env node
/**
 * Static workspace digest for AI orientation — no network, no LLM.
 * Excludes common secret paths and dependency trees by default.
 *
 * Usage: node out/duoDigestCli.js [workspaceRoot]
 * Default workspaceRoot: process.cwd()
 * Output: duo-digest.md in workspaceRoot
 */
import * as fs from "fs";
import * as path from "path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "out",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".venv",
  "vendor",
  ".next",
  ".nuxt",
  "target",
]);

function isSensitivePath(rel: string): boolean {
  const lower = rel.replace(/\\/g, "/").toLowerCase();
  const base = path.basename(lower);
  if (base.startsWith(".env")) return true;
  if (/(\/|^)(\.ssh|\.aws|\.gnupg)(\/|$)/.test(lower)) return true;
  if (/secret|credential|private[_-]?key|\.pem$|\.p12$|\.pfx$|id_rsa|\.key$|token|password|auth\.json$/i.test(lower))
    return true;
  return false;
}

function walk(root: string, rel = "", acc: string[], skipped: { dir: number; file: number }): void {
  const full = path.join(root, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(full, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) {
        skipped.dir++;
        continue;
      }
      walk(root, r, acc, skipped);
    } else if (e.isFile()) {
      if (isSensitivePath(r)) {
        skipped.file++;
        continue;
      }
      acc.push(r);
    }
  }
}

function main(): void {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`duo-digest: not a directory: ${root}`);
    process.exit(1);
  }

  const files: string[] = [];
  const skipped = { dir: 0, file: 0 };
  walk(root, "", files, skipped);
  files.sort((a, b) => a.localeCompare(b));

  const generatedAt = new Date().toISOString();
  const lines: string[] = [
    "# Duo digest (static)",
    "",
    `**Generated at:** ${generatedAt}`,
    `**Root:** \`${root.replace(/\\/g, "/")}\``,
    `**File count (listed):** ${files.length}`,
    `**Skipped dependency-style dirs:** ${skipped.dir} (e.g. node_modules, .git, out, dist, …)`,
    `**Skipped sensitive-looking paths:** ${skipped.file}`,
    "",
    "> Re-run after major refactors. If many paths are wrong or missing, regenerate this file.",
    "",
    "## File paths (no contents — avoids leaking secrets)",
    "",
    "```",
    ...files.map((f) => f.replace(/\\/g, "/")),
    "```",
    "",
  ];

  const outPath = path.join(root, "duo-digest.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`duo-digest: wrote ${outPath} (${files.length} paths).`);
}

main();

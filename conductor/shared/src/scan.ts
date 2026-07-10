import * as fs from "fs";
import * as path from "path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  "__pycache__",
  ".venv",
  "vendor",
  "target",
]);

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const CONFIG_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "docker-compose.yml",
  "Dockerfile",
]);

const MAX_DEPTH = 4;

function extractExports(content: string): string[] {
  const names: string[] = [];
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+class\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+type\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
    /export\s+enum\s+(\w+)/g,
    /export\s*\{\s*([^}]+)\}/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1].includes(",")) {
        for (const part of m[1].split(",")) {
          const n = part.trim().split(/\s+as\s+/)[0].trim();
          if (n && /^[\w$]+$/.test(n)) names.push(n);
        }
      } else if (m[1]) {
        names.push(m[1]);
      }
    }
  }
  return [...new Set(names)].slice(0, 12);
}

function extractRoutes(content: string): string[] {
  const routes: string[] = [];
  const express = /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let m: RegExpExecArray | null;
  while ((m = express.exec(content)) !== null) {
    routes.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return [...new Set(routes)].slice(0, 8);
}

function scanFile(rel: string, full: string): string[] {
  const base = path.basename(rel);
  const ext = path.extname(rel);
  const hints: string[] = [];

  if (CONFIG_NAMES.has(base)) {
    return [`${rel.replace(/\\/g, "/")}  ← config`];
  }

  if (!CODE_EXT.has(ext)) return [];

  let content: string;
  try {
    content = fs.readFileSync(full, "utf8");
    if (content.length > 120_000) content = content.slice(0, 120_000);
  } catch {
    return [];
  }

  const relPosix = rel.replace(/\\/g, "/");
  const exports = extractExports(content);
  const routes = extractRoutes(content);

  if (exports.length) hints.push(`${relPosix}  ← exports: ${exports.join(", ")}`);
  else hints.push(`${relPosix}`);

  if (routes.length) {
    hints[hints.length - 1] = `${relPosix}  ← routes: ${routes.join(", ")}`;
    if (exports.length) {
      hints[hints.length - 1] = `${relPosix}  ← exports: ${exports.join(", ")}; routes: ${routes.join(", ")}`;
    }
  }

  return hints;
}

function walk(
  root: string,
  rel: string,
  depth: number,
  acc: string[]
): void {
  if (depth > MAX_DEPTH) return;
  const full = path.join(root, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(full, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walk(root, r, depth + 1, acc);
    } else if (e.isFile()) {
      const lines = scanFile(r, path.join(root, r));
      acc.push(...lines);
    }
  }
}

/** Plain-text project map for rules injection. Empty string if nothing useful. */
export function scanProjectMap(root: string): string {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return "";
  }

  const lines: string[] = [];
  walk(resolved, "", 0, lines);

  if (lines.length === 0) return "";

  const header = `# Existing Codebase\n\nRoot: \`${resolved.replace(/\\/g, "/")}\`\n\n`;
  return header + lines.slice(0, 400).join("\n");
}

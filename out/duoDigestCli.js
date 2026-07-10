#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Static workspace digest for AI orientation — no network, no LLM.
 * Excludes common secret paths and dependency trees by default.
 *
 * Usage: node out/duoDigestCli.js [workspaceRoot]
 * Default workspaceRoot: process.cwd()
 * Output: duo-digest.md in workspaceRoot
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
function isSensitivePath(rel) {
    const lower = rel.replace(/\\/g, "/").toLowerCase();
    const base = path.basename(lower);
    if (base.startsWith(".env"))
        return true;
    if (/(\/|^)(\.ssh|\.aws|\.gnupg)(\/|$)/.test(lower))
        return true;
    if (/secret|credential|private[_-]?key|\.pem$|\.p12$|\.pfx$|id_rsa|\.key$|token|password|auth\.json$/i.test(lower))
        return true;
    return false;
}
function walk(root, rel = "", acc, skipped) {
    const full = path.join(root, rel);
    let entries;
    try {
        entries = fs.readdirSync(full, { withFileTypes: true });
    }
    catch {
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
        }
        else if (e.isFile()) {
            if (isSensitivePath(r)) {
                skipped.file++;
                continue;
            }
            acc.push(r);
        }
    }
}
function main() {
    const root = path.resolve(process.argv[2] ?? process.cwd());
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        console.error(`duo-digest: not a directory: ${root}`);
        process.exit(1);
    }
    const files = [];
    const skipped = { dir: 0, file: 0 };
    walk(root, "", files, skipped);
    files.sort((a, b) => a.localeCompare(b));
    const generatedAt = new Date().toISOString();
    const lines = [
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
//# sourceMappingURL=duoDigestCli.js.map
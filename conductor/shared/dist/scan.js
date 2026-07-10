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
exports.scanProjectMap = scanProjectMap;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
function extractExports(content) {
    const names = [];
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
        let m;
        while ((m = re.exec(content)) !== null) {
            if (m[1].includes(",")) {
                for (const part of m[1].split(",")) {
                    const n = part.trim().split(/\s+as\s+/)[0].trim();
                    if (n && /^[\w$]+$/.test(n))
                        names.push(n);
                }
            }
            else if (m[1]) {
                names.push(m[1]);
            }
        }
    }
    return [...new Set(names)].slice(0, 12);
}
function extractRoutes(content) {
    const routes = [];
    const express = /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let m;
    while ((m = express.exec(content)) !== null) {
        routes.push(`${m[1].toUpperCase()} ${m[2]}`);
    }
    return [...new Set(routes)].slice(0, 8);
}
function scanFile(rel, full) {
    const base = path.basename(rel);
    const ext = path.extname(rel);
    const hints = [];
    if (CONFIG_NAMES.has(base)) {
        return [`${rel.replace(/\\/g, "/")}  ← config`];
    }
    if (!CODE_EXT.has(ext))
        return [];
    let content;
    try {
        content = fs.readFileSync(full, "utf8");
        if (content.length > 120000)
            content = content.slice(0, 120000);
    }
    catch {
        return [];
    }
    const relPosix = rel.replace(/\\/g, "/");
    const exports = extractExports(content);
    const routes = extractRoutes(content);
    if (exports.length)
        hints.push(`${relPosix}  ← exports: ${exports.join(", ")}`);
    else
        hints.push(`${relPosix}`);
    if (routes.length) {
        hints[hints.length - 1] = `${relPosix}  ← routes: ${routes.join(", ")}`;
        if (exports.length) {
            hints[hints.length - 1] = `${relPosix}  ← exports: ${exports.join(", ")}; routes: ${routes.join(", ")}`;
        }
    }
    return hints;
}
function walk(root, rel, depth, acc) {
    if (depth > MAX_DEPTH)
        return;
    const full = path.join(root, rel);
    let entries;
    try {
        entries = fs.readdirSync(full, { withFileTypes: true });
    }
    catch {
        return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name) || e.name.startsWith("."))
                continue;
            walk(root, r, depth + 1, acc);
        }
        else if (e.isFile()) {
            const lines = scanFile(r, path.join(root, r));
            acc.push(...lines);
        }
    }
}
/** Plain-text project map for rules injection. Empty string if nothing useful. */
function scanProjectMap(root) {
    const resolved = path.resolve(root);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return "";
    }
    const lines = [];
    walk(resolved, "", 0, lines);
    if (lines.length === 0)
        return "";
    const header = `# Existing Codebase\n\nRoot: \`${resolved.replace(/\\/g, "/")}\`\n\n`;
    return header + lines.slice(0, 400).join("\n");
}
//# sourceMappingURL=scan.js.map
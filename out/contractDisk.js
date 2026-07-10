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
exports.hashContent = hashContent;
exports.sanitizeServiceSlug = sanitizeServiceSlug;
exports.parseServiceFromContent = parseServiceFromContent;
exports.resolveServiceSlug = resolveServiceSlug;
exports.writeContractRevisionToDisk = writeContractRevisionToDisk;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function hashContent(content) {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
/** Slug: lowercase letters, digits, hyphens; max 64 chars. */
function sanitizeServiceSlug(raw) {
    let s = raw
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
    if (!s)
        s = "contract";
    return s;
}
/** Parse `service: foo-bar` from first lines of content. */
function parseServiceFromContent(content) {
    const m = content.match(/^\s*service:\s*([^\s\r\n]+)/im);
    if (!m)
        return undefined;
    return sanitizeServiceSlug(m[1]);
}
function resolveServiceSlug(content, explicit) {
    if (explicit?.trim())
        return sanitizeServiceSlug(explicit.trim());
    const parsed = parseServiceFromContent(content);
    if (parsed)
        return parsed;
    const h = hashContent(content).slice(0, 8);
    return `general-${h}`;
}
/** Prepends a new revision block; older content kept below a horizontal rule. */
function writeContractRevisionToDisk(workspaceRoot, slug, entry) {
    const dir = path.join(workspaceRoot, "contracts");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${slug}.md`);
    const titleLine = entry.title ? `**Title:** ${entry.title}\n` : "";
    const block = `<!-- duo-agent contract revision — safe to commit after redacting secrets -->\n` +
        `## Revision ${entry.revision} — ${entry.timestamp}\n` +
        `**Agent:** ${entry.agentId}  \n` +
        titleLine +
        `**contentHash:** \`${entry.contentHash}\`\n\n` +
        `${entry.content.trim()}\n`;
    let body = block;
    if (fs.existsSync(filePath)) {
        const prev = fs.readFileSync(filePath, "utf8");
        body = `${block}\n\n---\n\n${prev}`;
    }
    else {
        body = `# Duo Agent — contract: \`${slug}\`\n\n${block}`;
    }
    fs.writeFileSync(filePath, body, "utf8");
    return filePath;
}
//# sourceMappingURL=contractDisk.js.map
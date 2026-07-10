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
exports.injectedRulePath = injectedRulePath;
exports.buildRuleContent = buildRuleContent;
exports.injectRule = injectRule;
exports.removeInjectedRule = removeInjectedRule;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("./types");
function injectedRulePath(workspaceRoot) {
    return path.join(workspaceRoot, ".cursor", "rules", types_1.INJECTED_RULE_FILENAME);
}
function buildRuleContent(agentId, brief, projectMap) {
    const mapSection = projectMap.trim()
        ? `\n\n## Project map\n\n${projectMap.trim()}`
        : "";
    return `---
description: Conductor session — auto-injected; removed on conductor stop
alwaysApply: true
---

# Conductor session

**Your agent id:** \`${agentId}\` (use this in all Conductor MCP tool calls)

## Your brief

${brief.trim()}
${mapSection}

## MCP protocol (Conductor server)

1. Before new work that depends on the other agent: \`get_contract\` with \`sinceVersion\` set to the last version you processed.
2. After producing something the other agent needs: \`post_update\` with \`type\`, \`summary\`, optional \`diff\`, and \`refs\` (file paths relative to project root).
3. After a major feature: \`post_checkpoint\` — both agents pause until the user runs \`conductor feedback\`.
4. After checkpoint resume: \`get_resume_brief\` once, then continue with \`get_contract\` deltas only.
5. To see peer progress: \`get_status\`.

Do not poll \`get_contract\` in a tight loop. Read file contents locally using \`refs\` from contract lines.
`;
}
function injectRule(workspaceRoot, agentId, brief, projectMap) {
    const filePath = injectedRulePath(workspaceRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content = buildRuleContent(agentId, brief, projectMap);
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
}
function removeInjectedRule(workspaceRoot) {
    const filePath = injectedRulePath(workspaceRoot);
    try {
        if (fs.existsSync(filePath))
            fs.unlinkSync(filePath);
    }
    catch {
        /* best effort */
    }
}
//# sourceMappingURL=rules.js.map
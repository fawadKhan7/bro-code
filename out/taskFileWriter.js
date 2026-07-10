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
exports.CONTRACTS_TEMPLATE = void 0;
exports.buildTasksMarkdown = buildTasksMarkdown;
exports.writeTaskFilesToDisk = writeTaskFilesToDisk;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function buildTasksMarkdown(agentId, task, mode) {
    const modeLabel = mode === "checkpoint"
        ? "Checkpoint (pause at milestones for user review)"
        : "Auto-run (work until done)";
    return `# Duo Agent — Agent ${agentId} Task

## Mode: ${modeLabel}

## Your Task

${task}

## Collaboration Rules

- Use \`post_contract\` to share interfaces, API shapes, or data formats with the other agent.
- Use \`get_contracts\` regularly to see what the other agent has shared.
- Use \`post_update\` to log your progress (visible in the Duo Agent panel).
${mode === "checkpoint"
        ? "- CHECKPOINT mode: call `post_checkpoint` before any major or irreversible action and wait for user approval via `get_checkpoint_status`."
        : "- AUTO-RUN mode: work until your task is fully complete."}

Each \`post_contract\` also appends a revision under \`contracts/<service>.md\` in this workspace (disk mirror for CI and humans). Legacy \`CONTRACTS.md\` may still exist as a template; prefer \`contracts/*.md\` for authoritative history.
`;
}
exports.CONTRACTS_TEMPLATE = `# Duo Agent — Shared Contracts (legacy)

Authoritative contract history is written to \`contracts/<service>.md\` on each \`post_contract\` call.
You can keep this file for notes or delete it if you only use \`contracts/*.md\`.

---

<!-- Optional manual notes -->
`;
/** Writes TASKS.md and creates CONTRACTS.md if missing (Node fs — used by CLI and extension). */
function writeTaskFilesToDisk(workspaceRoot, agentId, task, mode) {
    const tasksPath = path.join(workspaceRoot, "TASKS.md");
    fs.writeFileSync(tasksPath, buildTasksMarkdown(agentId, task, mode), "utf8");
    const contractsPath = path.join(workspaceRoot, "CONTRACTS.md");
    if (!fs.existsSync(contractsPath)) {
        fs.writeFileSync(contractsPath, exports.CONTRACTS_TEMPLATE, "utf8");
    }
}
//# sourceMappingURL=taskFileWriter.js.map
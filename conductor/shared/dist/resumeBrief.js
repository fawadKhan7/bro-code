"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildResumeBrief = buildResumeBrief;
const contractFormat_1 = require("./contractFormat");
/** Condensed context after checkpoint resume — no LLM. */
function buildResumeBrief(session, feedback) {
    const recent = session.updates.slice(-8);
    const lines = [
        `# Resume brief (v${session.resumeBriefVersion})`,
        "",
        `**Goal:** ${session.goal}`,
        "",
    ];
    if (feedback) {
        lines.push(`**User feedback:** ${feedback}`, "");
    }
    lines.push("## Recent contract updates", "", (0, contractFormat_1.formatContractLines)(recent), "");
    const pendingA = session.checkpointA?.status === "pending";
    const pendingB = session.checkpointB?.status === "pending";
    if (!pendingA && !pendingB) {
        lines.push("## Checkpoints", "", "All checkpoints cleared. Continue with the shared goal.", "");
    }
    lines.push("Use `get_contract` with your last `sinceVersion` for anything older than the list above.");
    return lines.join("\n");
}
//# sourceMappingURL=resumeBrief.js.map
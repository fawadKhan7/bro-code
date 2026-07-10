"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdFeedback = cmdFeedback;
const shared_1 = require("@conductor/shared");
function cmdFeedback(message) {
    const s = (0, shared_1.loadSession)();
    if (!s.active) {
        console.error("No active session.");
        process.exit(1);
    }
    (0, shared_1.applyFeedback)(s, message);
    const updated = (0, shared_1.loadSession)();
    console.log("Checkpoint cleared. Agents may call get_resume_brief.\n");
    if (message)
        console.log(`Feedback: ${message}\n`);
    if (updated.resumeBrief) {
        console.log("--- Resume brief preview ---\n");
        console.log(updated.resumeBrief);
        console.log("\n--- end ---");
    }
}
//# sourceMappingURL=feedback.js.map
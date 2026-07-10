"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdStatus = cmdStatus;
const shared_1 = require("@conductor/shared");
const shared_2 = require("@conductor/shared");
function cmdStatus() {
    const s = (0, shared_2.loadSession)();
    if (!s.active) {
        console.log("No active session. Run: conductor start \"<goal>\"");
        return;
    }
    console.log("Conductor session\n");
    console.log(`  Goal:      ${s.goal}`);
    console.log(`  Preset:    ${s.preset}`);
    console.log(`  Phase:     ${s.checkpointPhase}`);
    console.log(`  Contract:  v${s.contractVersion}`);
    console.log(`  Started:   ${s.startedAt}`);
    console.log(`  Agent A:   ${s.pathA}`);
    console.log(`  Agent B:   ${s.pathB}`);
    if (s.checkpointA) {
        console.log(`\n  Checkpoint A [${s.checkpointA.status}]: ${s.checkpointA.summary}`);
        console.log(`    Next: ${s.checkpointA.nextStep}`);
    }
    if (s.checkpointB) {
        console.log(`\n  Checkpoint B [${s.checkpointB.status}]: ${s.checkpointB.summary}`);
        console.log(`    Next: ${s.checkpointB.nextStep}`);
    }
    const recent = s.updates.slice(-6);
    if (recent.length) {
        console.log("\n  Recent updates:\n");
        console.log((0, shared_1.formatContractLines)(recent)
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n"));
    }
}
//# sourceMappingURL=status.js.map
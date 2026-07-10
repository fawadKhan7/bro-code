"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStartArgs = parseStartArgs;
const shared_1 = require("@conductor/shared");
function parseStartArgs(argv) {
    let goal = null;
    let preset;
    let briefA;
    let briefB;
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--preset" && argv[i + 1]) {
            const p = argv[++i];
            if ((0, shared_1.isPresetId)(p))
                preset = p;
            continue;
        }
        if (a === "--agent-a" && argv[i + 1]) {
            briefA = argv[++i];
            continue;
        }
        if (a === "--agent-b" && argv[i + 1]) {
            briefB = argv[++i];
            continue;
        }
        if (!a.startsWith("-"))
            positional.push(a);
    }
    if (positional.length > 0) {
        goal = positional.join(" ");
    }
    return { goal, preset, briefA, briefB };
}
//# sourceMappingURL=parseArgs.js.map
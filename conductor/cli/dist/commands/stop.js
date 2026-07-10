"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdStop = cmdStop;
const shared_1 = require("@conductor/shared");
function cmdStop() {
    const s = (0, shared_1.loadSession)();
    if (s.pathA)
        (0, shared_1.removeInjectedRule)(s.pathA);
    if (s.pathB)
        (0, shared_1.removeInjectedRule)(s.pathB);
    (0, shared_1.saveSession)((0, shared_1.emptySession)());
    console.log("Conductor session stopped. Injected rules removed.");
}
//# sourceMappingURL=stop.js.map
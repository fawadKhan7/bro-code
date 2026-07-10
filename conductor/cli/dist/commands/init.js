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
exports.cmdInit = cmdInit;
const path = __importStar(require("path"));
const shared_1 = require("@conductor/shared");
const prompt_1 = require("../prompt");
async function cmdInit() {
    console.log("Conductor init — register two project folders (no API keys).\n");
    const pathA = path.resolve(await (0, prompt_1.ask)("Agent A workspace path: "));
    const pathB = path.resolve(await (0, prompt_1.ask)("Agent B workspace path: "));
    console.log("\nPresets:");
    for (const p of Object.values(shared_1.PRESETS)) {
        console.log(`  ${p.id} — ${p.label}`);
    }
    console.log("  custom — define roles in config or per-start --agent-a/--agent-b\n");
    const presetRaw = (await (0, prompt_1.ask)("Default preset [frontend-backend]: ")) || "frontend-backend";
    const preset = (0, shared_1.isPresetId)(presetRaw) ? presetRaw : "frontend-backend";
    const config = { pathA, pathB, preset };
    if (preset === "custom") {
        config.customRoleA = (await (0, prompt_1.ask)("Custom role name for A: ")) || "Agent A";
        config.customRoleB = (await (0, prompt_1.ask)("Custom role name for B: ")) || "Agent B";
    }
    (0, shared_1.saveConfig)(config);
    console.log("\nSaved ~/.conductor/config.json");
    console.log("Next: conductor start \"<your goal>\"");
}
//# sourceMappingURL=init.js.map
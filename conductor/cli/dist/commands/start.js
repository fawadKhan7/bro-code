"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdStart = cmdStart;
const shared_1 = require("@conductor/shared");
const parseArgs_1 = require("../parseArgs");
const mcpSnippet_1 = require("../mcpSnippet");
async function cmdStart(argv) {
    const config = (0, shared_1.loadConfig)();
    if (!config) {
        console.error("Run conductor init first.");
        process.exit(1);
    }
    const args = (0, parseArgs_1.parseStartArgs)(argv);
    if (!args.goal && !(args.briefA && args.briefB)) {
        console.error('Usage: conductor start "<goal>" [--preset name]');
        console.error("   or: conductor start --agent-a \"...\" --agent-b \"...\"");
        process.exit(1);
    }
    const goal = args.goal ?? "See per-agent briefs.";
    const preset = args.preset ?? config.preset;
    const { briefA, briefB } = (0, shared_1.buildBriefs)(goal, preset, {
        briefA: args.briefA,
        briefB: args.briefB,
        customRoleA: config.customRoleA,
        customRoleB: config.customRoleB,
    });
    const existing = (0, shared_1.loadSession)();
    if (existing.active) {
        (0, shared_1.removeInjectedRule)(existing.pathA);
        (0, shared_1.removeInjectedRule)(existing.pathB);
    }
    const mapA = (0, shared_1.scanProjectMap)(config.pathA);
    const mapB = (0, shared_1.scanProjectMap)(config.pathB);
    const injectedRuleA = (0, shared_1.injectRule)(config.pathA, "agent-a", briefA, mapA);
    const injectedRuleB = (0, shared_1.injectRule)(config.pathB, "agent-b", briefB, mapB);
    const session = {
        active: true,
        goal,
        preset,
        pathA: config.pathA,
        pathB: config.pathB,
        briefA,
        briefB,
        injectedRuleA,
        injectedRuleB,
        contractVersion: 0,
        updates: [],
        checkpointA: null,
        checkpointB: null,
        checkpointPhase: "idle",
        lastFeedback: null,
        resumeBriefVersion: 0,
        resumeBrief: null,
        startedAt: new Date().toISOString(),
    };
    (0, shared_1.saveSession)(session);
    const mcpPath = (0, mcpSnippet_1.defaultMcpServerPath)();
    console.log("Conductor session started.\n");
    console.log(`Goal: ${goal}`);
    console.log(`Preset: ${preset}`);
    console.log(`Agent A: ${config.pathA}`);
    console.log(`Agent B: ${config.pathB}`);
    console.log(`\nInjected rules:\n  ${injectedRuleA}\n  ${injectedRuleB}`);
    console.log("\nAdd to Cursor MCP settings (~/.cursor/mcp.json), then restart Cursor:\n");
    console.log((0, mcpSnippet_1.mcpConfigSnippet)(mcpPath));
    console.log("\nOpen each workspace in Cursor and start background agents on the shared goal.");
    console.log("Monitor: conductor status  |  Checkpoint: conductor feedback [message]");
}
//# sourceMappingURL=start.js.map
#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const init_1 = require("./commands/init");
const start_1 = require("./commands/start");
const status_1 = require("./commands/status");
const feedback_1 = require("./commands/feedback");
const stop_1 = require("./commands/stop");
const [, , command, ...rest] = process.argv;
function usage() {
    console.log(`Conductor — coordinate two Cursor agents (no API keys)

Commands:
  init                         Register workspace paths + default preset
  start "<goal>" [--preset id] Start session, inject .cursor/rules
  start --agent-a "..." --agent-b "..."   Explicit briefs
  status                       Session progress
  feedback [message]           Resume after checkpoint
  stop                         End session and remove injected rules

Examples:
  conductor init
  conductor start "Build auth" --preset frontend-backend
  conductor feedback "add refresh tokens"
`);
}
async function main() {
    switch (command) {
        case "init":
            await (0, init_1.cmdInit)();
            break;
        case "start":
            await (0, start_1.cmdStart)(rest);
            break;
        case "status":
            (0, status_1.cmdStatus)();
            break;
        case "feedback":
            (0, feedback_1.cmdFeedback)(rest.length ? rest.join(" ") : null);
            break;
        case "stop":
            (0, stop_1.cmdStop)();
            break;
        case undefined:
        case "help":
        case "-h":
        case "--help":
            usage();
            break;
        default:
            console.error(`Unknown command: ${command}\n`);
            usage();
            process.exit(1);
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=index.js.map
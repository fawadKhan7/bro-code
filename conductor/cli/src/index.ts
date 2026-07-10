#!/usr/bin/env node
import { cmdInit } from "./commands/init";
import { cmdStart } from "./commands/start";
import { cmdStatus } from "./commands/status";
import { cmdFeedback } from "./commands/feedback";
import { cmdStop } from "./commands/stop";

const [, , command, ...rest] = process.argv;

function usage(): void {
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

async function main(): Promise<void> {
  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "start":
      await cmdStart(rest);
      break;
    case "status":
      cmdStatus();
      break;
    case "feedback":
      cmdFeedback(rest.length ? rest.join(" ") : null);
      break;
    case "stop":
      cmdStop();
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

#!/usr/bin/env node
/** `duo` CLI entry — argument parsing + command dispatch. */
import { cmdInit } from "./commands/init.js";
import { cmdStart } from "./commands/start.js";
import {
  cmdApprove,
  cmdBoard,
  cmdFeedback,
  cmdOutOfScope,
  cmdPlan,
  cmdStatus,
  cmdStop,
} from "./commands/control.js";
import { cmdChat } from "./commands/chat.js";
import { cmdResume } from "./commands/resume.js";
import { cmdDoctor } from "./commands/doctor.js";
import { cmdOpen } from "./commands/open.js";

export { HubClient } from "./hubClient.js";

interface ParsedFlags {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedFlags {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

/** Parse repeated `--assign tN=agent` into a map. Accepts one value or comma-separated. */
function parseAssign(value: string | boolean | undefined): Record<string, string> | undefined {
  if (typeof value !== "string") return undefined;
  const out: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const [id, agent] = pair.split("=");
    if (id && agent) out[id.trim()] = agent.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function parseList(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

const HELP = `BroCode (duo) — multi-agent AI collaboration

Usage:
  duo                               Open the dashboard (starts the hub)
  duo init                          Configure agents (interactive)
  duo start "<goal>" [--no-plan] [--mode checkpoint|auto-run|ask]
  duo plan                          Review the proposed board
  duo approve [--assign tN=agent,...] [--out-of-scope tN,...] [--agent <id>]
  duo feedback "<msg>" [--agent <id>]
  duo chat                          Talk with the agents (live transcript + input)
  duo chat "<msg>" [--agent <id>]   Send one message ("@A <msg>" also targets an agent)
  duo status [--watch]
  duo board                         Show the execution board
  duo out-of-scope tN,...           Mark items out of scope (human-only)
  duo resume <agent>                Relaunch a crashed agent
  duo stop [--clean]
  duo doctor
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rest);

  switch (command) {
    case "init":
      return cmdInit();

    case "start": {
      const goal = positionals.join(" ").trim();
      if (!goal) return void console.error('Usage: duo start "<goal>"');
      const mode = (["checkpoint", "auto-run", "ask"] as const).find((m) => m === flags.mode);
      return cmdStart({ goal, noPlan: flags["no-plan"] === true, mode });
    }

    case "plan":
      return cmdPlan();

    case "approve":
      return cmdApprove({
        assign: parseAssign(flags.assign),
        outOfScope: parseList(flags["out-of-scope"]),
        remove: parseList(flags.remove),
        agent: typeof flags.agent === "string" ? flags.agent : undefined,
      });

    case "feedback": {
      const message = positionals.join(" ").trim();
      if (!message) return void console.error('Usage: duo feedback "<message>" [--agent <id>]');
      return cmdFeedback({ message, agent: typeof flags.agent === "string" ? flags.agent : undefined });
    }

    case "chat": {
      const message = positionals.join(" ").trim();
      return cmdChat({
        message: message || undefined,
        agent: typeof flags.agent === "string" ? flags.agent : undefined,
      });
    }

    case "status":
      return cmdStatus(flags.watch === true);

    case "board":
      return cmdBoard();

    case "out-of-scope": {
      const ids = parseList(positionals.join(",")) ?? [];
      if (!ids.length) return void console.error("Usage: duo out-of-scope tN,...");
      return cmdOutOfScope(ids);
    }

    case "resume": {
      const agent = positionals[0];
      if (!agent) return void console.error("Usage: duo resume <agent>");
      return cmdResume(agent);
    }

    case "stop":
      return cmdStop(flags.clean === true);

    case "doctor":
      return cmdDoctor();

    case "open":
    case undefined:
      return cmdOpen();

    case "help":
    case "--help":
    case "-h":
      return void console.log(HELP);

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

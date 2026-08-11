/** `duo chat` — the conversation with the agents, in the terminal.
 *  One-shot: `duo chat "message" [--agent <id>]` sends and exits.
 *  Interactive: `duo chat` shows the transcript live; typed lines are sent to the agents
 *  ("@A message" targets one agent). Agents that already finished are woken by the hub.
 */
import * as readline from "readline";
import type { ChatMessage, HubEvent } from "@duo/shared";
import { requireHub } from "../context.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";

function color(code: string, text: string): string {
  return process.stdout.isTTY ? `${code}${text}${RESET}` : text;
}

function renderMessage(msg: ChatMessage, roleOf: (id: string) => string): string {
  const time = msg.timestamp.slice(11, 16);
  const who =
    msg.from === "user"
      ? color(GREEN, `you → ${msg.to === "all" ? "all agents" : roleOf(msg.to)}`)
      : color(CYAN, roleOf(msg.from));
  return `${color(DIM, time)} ${color(BOLD, who)}  ${msg.text}`;
}

export interface ChatArgs {
  message?: string;
  agent?: string;
}

export async function cmdChat(args: ChatArgs): Promise<void> {
  const { hub } = await requireHub();

  const status = (await hub.status()) as {
    active?: boolean;
    agents?: Array<{ id: string; role: string }>;
  };
  if (!status.active) {
    console.error('✗ No active session. Start one with `duo start "<goal>"`.');
    process.exit(1);
  }
  const roles: Record<string, string> = {};
  for (const a of status.agents ?? []) roles[a.id] = a.role;
  const roleOf = (id: string) => roles[id] ?? id;

  // One-shot send.
  if (args.message) {
    const res = await hub.sendChat(args.message, args.agent);
    if (res.ok !== true) {
      console.error(`✗ ${String(res.error ?? "could not send")}`);
      process.exit(1);
    }
    console.log(`✓ Sent to ${args.agent ? roleOf(args.agent) : "all agents"}. Watch replies with \`duo chat\`.`);
    return;
  }

  // Interactive: print the transcript, then stream + prompt.
  const initial = (await hub.chat()) as { messages?: ChatMessage[] };
  let lastId = 0;
  for (const msg of initial.messages ?? []) {
    console.log(renderMessage(msg, roleOf));
    lastId = Math.max(lastId, msg.id);
  }
  console.log(color(DIM, `— chatting with ${Object.values(roles).join(" + ")} · "@${Object.keys(roles)[0] ?? "A"} …" targets one agent · Ctrl-C to leave —`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  let stopStream: (() => void) | null = null;
  let closed = false;
  // Register before any await: piped/EOF stdin closes the interface immediately.
  rl.on("close", () => {
    closed = true;
    stopStream?.();
    console.log("");
    process.exit(0);
  });

  const printIncoming = (msg: ChatMessage) => {
    if (closed || msg.id <= lastId) return;
    lastId = msg.id;
    // Keep the prompt line clean: erase it, print the message, redraw.
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(renderMessage(msg, roleOf));
    rl.prompt(true);
  };

  stopStream = await hub.subscribe((event: HubEvent) => {
    if (event.type === "chat" && event.data) printIncoming(event.data as ChatMessage);
  });

  if (!closed) rl.prompt();
  rl.on("line", (line) => {
    void (async () => {
      let text = line.trim();
      if (!text) return void (closed || rl.prompt());
      let to: string | undefined = args.agent;
      const directed = text.match(/^@(\S+)\s+(.+)$/s);
      if (directed && roles[directed[1]]) {
        to = directed[1];
        text = directed[2];
      }
      // Sent messages come back over SSE and echo into the transcript like everyone else's.
      const res = await hub.sendChat(text, to);
      if (res.ok !== true) console.error(`✗ ${String(res.error ?? "could not send")}`);
      if (!closed) rl.prompt();
    })();
  });
}

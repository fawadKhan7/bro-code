/** Thin REST-client commands: plan, approve, feedback, status, logs, stop, out-of-scope. */
import { requireHub } from "../context.js";
import { renderStatus, renderPlan, renderBoard } from "../render.js";
import { stopHub } from "../hubProcess.js";

export async function cmdPlan(): Promise<void> {
  const { hub } = await requireHub();
  const board = (await hub.board()) as { proposedBoard?: unknown[]; plan?: { unassigned: string[] } };
  console.log(renderPlan((board.proposedBoard ?? []) as never));
}

export interface ApproveArgs {
  assign?: Record<string, string>;
  outOfScope?: string[];
  add?: Array<{ title: string; ownerHint?: string | null; paths?: string[] }>;
  remove?: string[];
  /** For resolving a checkpoint instead of a plan. */
  agent?: string;
}

export async function cmdApprove(args: ApproveArgs): Promise<void> {
  const { hub } = await requireHub();
  const status = (await hub.status()) as { phase?: string };

  // Checkpoint approval when a specific agent is named or the session is executing.
  if (args.agent) {
    const res = await hub.resolveCheckpoint(args.agent, true);
    report(res, `Checkpoint approved for Agent ${args.agent}.`);
    return;
  }

  if (status.phase === "planning") {
    const res = await hub.approvePlan({
      assign: args.assign,
      outOfScope: args.outOfScope,
      add: args.add,
      remove: args.remove,
    });
    if (res.ok === true) {
      console.log("✓ Plan approved. Agents resuming into execution.");
    } else {
      console.error(`✗ ${String(res.error)}`);
      process.exit(1);
    }
    return;
  }

  console.error("✗ Nothing to approve: no planning phase and no --agent checkpoint specified.");
  process.exit(1);
}

export interface FeedbackArgs {
  message: string;
  agent?: string;
}

export async function cmdFeedback(args: FeedbackArgs): Promise<void> {
  const { hub } = await requireHub();
  if (args.agent) {
    const res = await hub.resolveCheckpoint(args.agent, false, args.message);
    report(res, `Feedback sent to Agent ${args.agent}.`);
    return;
  }
  const status = (await hub.status()) as { phase?: string };
  if (status.phase === "planning") {
    const res = await hub.planFeedback(args.message);
    report(res, "Plan feedback sent — agents will revise and re-post.");
    return;
  }
  console.error("✗ Specify --agent <id> to send checkpoint feedback during execution.");
  process.exit(1);
}

export async function cmdStatus(watch: boolean): Promise<void> {
  const { hub } = await requireHub();
  const print = async () => {
    const status = await hub.status();
    if (watch) process.stdout.write("\x1b[2J\x1b[H");
    console.log(renderStatus(status as never));
  };
  await print();
  if (!watch) return;
  await hub.subscribe(() => void print());
  await new Promise(() => undefined); // run until Ctrl-C
}

export async function cmdBoard(): Promise<void> {
  const { hub } = await requireHub();
  const board = (await hub.board()) as { items?: unknown[] };
  console.log(renderBoard((board.items ?? []) as never));
}

export async function cmdOutOfScope(taskIds: string[]): Promise<void> {
  const { hub } = await requireHub();
  const res = await hub.markOutOfScope(taskIds);
  report(res, `Marked out of scope: ${taskIds.join(", ")}`);
}

export async function cmdStop(clean: boolean): Promise<void> {
  const { hub, config } = await requireHub();
  const res = (await hub.stop()) as { ok?: boolean; archive?: string | null };
  if (res.ok) {
    console.log(`✓ Session archived${res.archive ? `: ${res.archive}` : ""}.`);
  }
  stopHub();
  console.log("✓ Hub stopped.");
  if (clean) {
    console.log("  (--clean: workspace MCP configs left in place — remove .mcp.json manually if desired.)");
    void config;
  }
}

function report(res: Record<string, unknown>, successMsg: string): void {
  if (res.ok === true) {
    console.log(`✓ ${successMsg}`);
  } else {
    console.error(`✗ ${String(res.error ?? "failed")}`);
    process.exit(1);
  }
}

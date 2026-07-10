/** Terminal rendering for status/board/plan. Pure string builders (testable). */

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function color(code: string, text: string): string {
  return process.stdout.isTTY ? `${code}${text}${RESET}` : text;
}

interface StatusShape {
  active: boolean;
  phase: string;
  goal: string;
  mode: string;
  agents: Array<{
    id: string;
    role: string;
    runner: string;
    registered: boolean;
    planPosted: boolean;
    checkpoint: { status: string; summary?: string; nextStep?: string } | null;
  }>;
  board: { total: number; open: number; claimed: number; done: number; outOfScope: number };
  proposedItems: number;
}

export function renderStatus(status: StatusShape): string {
  if (!status.active) return "No active session. Run `duo start \"<goal>\"`.";

  const lines: string[] = [];
  lines.push(color(BOLD, `Goal: ${status.goal}`));
  lines.push(`Phase: ${color(CYAN, status.phase)}   Mode: ${status.mode}`);
  lines.push("");

  for (const a of status.agents) {
    const reg = a.registered ? color(GREEN, "●") : color(DIM, "○");
    let extra = "";
    if (a.checkpoint && a.checkpoint.status === "pending") {
      extra = color(YELLOW, `  ⏸ CHECKPOINT: ${a.checkpoint.summary ?? ""} → ${a.checkpoint.nextStep ?? ""}`);
    } else if (status.phase === "planning") {
      extra = a.planPosted ? color(DIM, "  plan posted") : color(DIM, "  planning…");
    }
    lines.push(`  ${reg} Agent ${a.id} [${a.role}/${a.runner}]${extra}`);
  }
  lines.push("");

  const b = status.board;
  if (status.phase === "planning") {
    lines.push(color(DIM, `Proposed items: ${status.proposedItems} (run \`duo plan\` to review)`));
  } else {
    lines.push(
      `Board: ${b.done}/${b.total} done` +
        `  ${color(DIM, `(open ${b.open}, claimed ${b.claimed}${b.outOfScope ? `, out-of-scope ${b.outOfScope}` : ""})`)}`
    );
  }
  return lines.join("\n");
}

interface BoardItemShape {
  id: string;
  title: string;
  owner: string | null;
  status: string;
  paths: string[];
  claimedBy: string | null;
}

export function renderPlan(proposed: BoardItemShape[]): string {
  if (proposed.length === 0) return "No proposed plan yet — waiting for agents to post.";
  const lines: string[] = [color(BOLD, "Proposed board:")];
  for (const item of proposed) {
    const owner = item.owner ? `[${item.owner}]` : color(YELLOW, "[—]");
    const paths = item.paths.length ? color(DIM, `  ${item.paths.join(", ")}`) : "";
    lines.push(`  ${item.id}  ${owner}  ${item.title}${paths}`);
  }
  const unassigned = proposed.filter((i) => !i.owner);
  if (unassigned.length) {
    lines.push("");
    lines.push(
      color(YELLOW, `${unassigned.length} unassigned — assign with \`duo approve --assign ${unassigned[0].id}=<agent>\``)
    );
  }
  return lines.join("\n");
}

export function renderBoard(items: BoardItemShape[]): string {
  if (items.length === 0) return "Board is empty.";
  const lines: string[] = [color(BOLD, "Board:")];
  const mark: Record<string, string> = {
    done: color(GREEN, "✓"),
    claimed: color(YELLOW, "◐"),
    open: color(DIM, "○"),
    "out-of-scope": color(DIM, "⊘"),
  };
  for (const item of items) {
    const who = item.claimedBy ?? item.owner ?? "—";
    lines.push(`  ${mark[item.status] ?? "?"} ${item.id} [${who}] ${item.title}`);
  }
  return lines.join("\n");
}

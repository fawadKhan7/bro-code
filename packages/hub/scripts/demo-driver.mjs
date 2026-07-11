/** Dashboard demo driver: a live hub + two scripted MCP-client agents that walk through every
 *  UI state (pending plan with an unassigned item → checkpoint → done). Not a test — a manual
 *  harness for verifying the dashboard in a browser. Run: node scripts/demo-driver.mjs
 */
import { Hub } from "../dist/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

process.env.DUO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "duo-demo-"));
process.env.DUO_LONGPOLL_MS = "1000";
const PORT = 3160;

const wsA = path.join(process.env.DUO_HOME, "web");
const wsB = path.join(process.env.DUO_HOME, "api");
fs.mkdirSync(wsA, { recursive: true });
fs.mkdirSync(wsB, { recursive: true });

const hub = new Hub({ port: PORT, persistFile: path.join(process.env.DUO_HOME, "s.json"), restore: false });
await hub.start();
console.log(`Dashboard: ${hub.url}`);

hub.store.createSession({
  goal: "Add Google OAuth login",
  agents: [
    { id: "A", workspace: wsA, runner: "cursor-cli", role: "Frontend" },
    { id: "B", workspace: wsB, runner: "claude-code", role: "Backend" },
  ],
  mode: "checkpoint",
  plan: true,
  autoApproveTrivial: false,
});

async function agent(id, ws) {
  const c = new Client({ name: `demo-${id}`, version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${hub.url}/mcp`)));
  const call = async (name, args = {}) => {
    const r = await c.callTool({ name, arguments: args });
    return JSON.parse(r.content.find((x) => x.type === "text").text);
  };
  return { c, call, id, ws };
}

const A = await agent("A", wsA);
const B = await agent("B", wsB);

await A.call("register_agent", { agent_id: "A", workspace_path: wsA });
await B.call("register_agent", { agent_id: "B", workspace_path: wsB });
await A.call("post_update", { agent_id: "A", message: "exploring the web workspace" });
await B.call("post_update", { agent_id: "B", message: "exploring the api workspace" });

await A.call("post_plan", { agent_id: "A", items: [
  { title: "Google login button + consent redirect", ownerHint: "A", paths: ["src/pages/login/"] },
  { title: "Store session token (httpOnly cookie)", ownerHint: "A", paths: ["src/lib/auth.ts"] },
]});
await B.call("post_plan", { agent_id: "B", items: [
  { title: "/auth/google + callback route", ownerHint: "B", paths: ["src/auth/"] },
  { title: "users.google_id migration", ownerHint: "B", paths: ["migrations/"] },
  { title: "Deploy secrets for GOOGLE_CLIENT_ID/SECRET", ownerHint: null, paths: ["infra/"] },
]});
console.log("→ Plan posted (1 unassigned item). Approve it in the dashboard.");

// Each agent waits for approval, then executes; B pauses at a checkpoint.
async function run(agent, isB) {
  for (;;) { const d = await agent.call("await_plan_approval", { agent_id: agent.id }); if (!d.pending) break; }
  const board = await agent.call("get_board");
  if (isB) await agent.call("post_contract", { agent_id: "B", service: "auth-api", content: "GET /auth/google/callback → { token, user: { id, email } }" });
  for (const item of board.items.filter((i) => i.owner === agent.id)) {
    await agent.call("claim_task", { agent_id: agent.id, task_id: item.id });
    await agent.call("post_update", { agent_id: agent.id, message: `working on ${item.title}` });
    if (isB && item.title.includes("migration")) {
      await agent.call("post_checkpoint", { agent_id: "B", summary: "Auth API + callback done, contract posted", next_step: "Run users.google_id migration on dev DB" });
      console.log("→ Checkpoint posted by B. Approve/feedback it in the dashboard.");
      for (;;) { const s = await agent.call("get_checkpoint_status", { agent_id: "B", wait: true }); if (s.status !== "pending") break; }
    }
    await agent.call("complete_task", { agent_id: agent.id, task_id: item.id, refs: [item.paths[0] || "x"] });
  }
}
run(A, false); run(B, true);

process.on("SIGINT", async () => { await hub.stop(); process.exit(0); });

/** Golden-file tests for the prompt builder: kickoff text changes must show up in diffs and
 *  be reviewed like code. Update goldens intentionally with UPDATE_GOLDENS=1.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { buildChatFollowUp, buildKickoff, buildResumeKickoff, type KickoffContext } from "../src/prompts/kickoff.js";
import type { AgentConfig } from "../src/types.js";

const goldenDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "goldens");

function golden(name: string, actual: string): void {
  fs.mkdirSync(goldenDir, { recursive: true });
  const file = path.join(goldenDir, name);
  if (process.env.UPDATE_GOLDENS === "1" || !fs.existsSync(file)) {
    fs.writeFileSync(file, actual, "utf8");
  }
  expect(actual).toBe(fs.readFileSync(file, "utf8"));
}

const agentA: AgentConfig = { id: "A", workspace: "/proj/web", runner: "claude-code", role: "Frontend" };
const agentB: AgentConfig = { id: "B", workspace: "/proj/api", runner: "claude-code", role: "Backend" };

const baseCtx: Omit<KickoffContext, "plan" | "approvalStyle" | "mode"> = {
  agent: agentB,
  peers: [agentA],
  goal: "Add Google OAuth login",
  brief:
    "Role: Backend\n\nShared goal: Add Google OAuth login\n\nPrimary responsibility: REST routes, auth, persistence.",
  projectMap:
    "# Existing Codebase\n\nRoot: `/proj/api`\n\nsrc/auth/auth.service.ts  ← exports: AuthService\nsrc/users/user.model.ts  ← exports: User",
  toolPrefix: "duo",
};

describe("kickoff prompt golden files", () => {
  it("planning + held + auto-run", () => {
    const prompt = buildKickoff({ ...baseCtx, plan: true, approvalStyle: "held", mode: "auto-run" });
    golden("planning-held-autorun.txt", prompt);
  });

  it("planning + polling + checkpoint", () => {
    const prompt = buildKickoff({ ...baseCtx, plan: true, approvalStyle: "polling", mode: "checkpoint" });
    golden("planning-polling-checkpoint.txt", prompt);
  });

  it("no-plan + auto-run", () => {
    const prompt = buildKickoff({ ...baseCtx, plan: false, approvalStyle: "held", mode: "auto-run" });
    golden("noplan-autorun.txt", prompt);
  });

  it("resume kickoff", () => {
    const prompt = buildResumeKickoff({ ...baseCtx, plan: false, approvalStyle: "held", mode: "checkpoint" });
    golden("resume-checkpoint.txt", prompt);
  });

  it("greenfield (empty project map)", () => {
    const prompt = buildKickoff({ ...baseCtx, projectMap: "", plan: true, approvalStyle: "held", mode: "auto-run" });
    golden("greenfield-planning.txt", prompt);
  });

  it("planning + held + ask", () => {
    const prompt = buildKickoff({ ...baseCtx, plan: true, approvalStyle: "held", mode: "ask" });
    golden("planning-held-ask.txt", prompt);
  });

  it("chat follow-up (waking a finished agent)", () => {
    const prompt = buildChatFollowUp(
      { ...baseCtx, plan: false, approvalStyle: "held", mode: "auto-run" },
      "Also add a logout button to the navbar"
    );
    golden("chat-followup-autorun.txt", prompt);
  });
});

describe("kickoff invariants", () => {
  it("always instructs registering first", () => {
    const prompt = buildKickoff({ ...baseCtx, plan: true, approvalStyle: "held", mode: "auto-run" });
    expect(prompt).toContain("register_agent");
    expect(prompt).toContain('agent_id "B"');
  });

  it("held vs polling differ in the approval instruction", () => {
    const held = buildKickoff({ ...baseCtx, plan: true, approvalStyle: "held", mode: "auto-run" });
    const polling = buildKickoff({ ...baseCtx, plan: true, approvalStyle: "polling", mode: "auto-run" });
    expect(held).toContain("await_plan_approval");
    expect(polling).toContain("get_plan_status");
    expect(polling).not.toContain("await_plan_approval");
  });

  it("no-plan omits the planning instructions", () => {
    const prompt = buildKickoff({ ...baseCtx, plan: false, approvalStyle: "held", mode: "auto-run" });
    expect(prompt).not.toContain("post_plan");
    expect(prompt).toContain("already on the board");
  });

  it("always tells agents how to chat with the user", () => {
    for (const prompt of [
      buildKickoff({ ...baseCtx, plan: true, approvalStyle: "held", mode: "auto-run" }),
      buildKickoff({ ...baseCtx, plan: false, approvalStyle: "held", mode: "checkpoint" }),
      buildResumeKickoff({ ...baseCtx, plan: false, approvalStyle: "held", mode: "checkpoint" }),
    ]) {
      expect(prompt).toContain("post_chat");
      expect(prompt).toContain("get_chat");
    }
  });

  it("chat follow-up embeds the user's message and recovery steps", () => {
    const prompt = buildChatFollowUp(
      { ...baseCtx, plan: false, approvalStyle: "held", mode: "checkpoint" },
      "Rename the /auth route"
    );
    expect(prompt).toContain("Rename the /auth route");
    expect(prompt).toContain("register_agent");
    expect(prompt).toContain("get_chat");
    expect(prompt).toContain("post_chat");
    expect(prompt).toContain("Checkpoint mode"); // mode rules still apply on wake
  });

  it("chat follow-up keeps the conversation alive (a session, not an errand)", () => {
    const prompt = buildChatFollowUp(
      { ...baseCtx, plan: false, approvalStyle: "held", mode: "auto-run" },
      "How does the token refresh work?"
    );
    expect(prompt).toContain("STAY in the conversation");
    expect(prompt).toContain("wait: true");
  });

  it("ask mode demands chat confirmation before acting", () => {
    const prompt = buildKickoff({ ...baseCtx, plan: true, approvalStyle: "held", mode: "ask" });
    expect(prompt).toContain("Ask mode");
    expect(prompt).toContain("Do NOT proceed until they answer");
    expect(prompt).toContain("post_chat");
  });

  it("binds the agent to its workspace and names the peer", () => {
    const prompt = buildKickoff({ ...baseCtx, plan: true, approvalStyle: "held", mode: "auto-run" });
    expect(prompt).toContain("/proj/api");
    expect(prompt).toContain("Agent A (Frontend)");
    expect(prompt).toContain("Work ONLY inside that folder");
  });
});

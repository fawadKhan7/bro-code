/** Phase 6 setup-support endpoints for GUIs: config read/write, sandboxed folder listing, runner
 *  detection. These are localhost-only and must be traversal-safe.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

describe("config endpoint", () => {
  it("rejects an invalid config and accepts a valid one", async () => {
    h = await startHarness();
    const bad = await fetch(`${h.url}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents: [{ id: "A" }] }),
    });
    expect(bad.status).toBe(400);

    const good = await fetch(`${h.url}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agents: [
          { id: "A", workspace: h.wsA, runner: "claude-code", role: "Frontend" },
          { id: "B", workspace: h.wsB, runner: "cursor-cli", role: "Backend" },
        ],
        preset: "frontend-backend",
        mode: "auto-run",
        port: 3131,
        claudePermissionMode: "acceptEdits",
      }),
    });
    expect(good.status).toBe(200);

    const read = (await fetch(`${h.url}/api/config`).then((r) => r.json())) as { config: { agents: unknown[] } };
    expect(read.config.agents).toHaveLength(2);
  });
});

describe("fs listing (sandboxed to home)", () => {
  it("lists directories under home and refuses to escape it", async () => {
    h = await startHarness();
    const home = os.homedir();

    const atHome = (await fetch(`${h.url}/api/fs/list?path=${encodeURIComponent(home)}`).then((r) => r.json())) as {
      path: string;
      dirs: string[];
      parent: string | null;
    };
    expect(atHome.path).toBe(home);
    expect(atHome.parent).toBeNull(); // can't go above home
    expect(Array.isArray(atHome.dirs)).toBe(true);

    // Traversal attempt → reset to home with an error note.
    const escape = (await fetch(`${h.url}/api/fs/list?path=${encodeURIComponent("/etc")}`).then((r) => r.json())) as {
      path: string;
      error?: string;
    };
    expect(escape.path).toBe(home);
    expect(escape.error).toBeTruthy();
  });
});

describe("runner detection", () => {
  it("returns a detect result per known runner", async () => {
    h = await startHarness();
    const res = (await fetch(`${h.url}/api/runners/detect`).then((r) => r.json())) as {
      runners: Array<{ runner: string; ok: boolean }>;
    };
    const names = res.runners.map((r) => r.runner);
    expect(names).toEqual(expect.arrayContaining(["claude-code", "cursor-cli", "cursor-ide"]));
    // cursor-ide is always usable (needs only a human).
    expect(res.runners.find((r) => r.runner === "cursor-ide")!.ok).toBe(true);
  });
});

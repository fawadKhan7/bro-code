/** Hub daemon lifecycle: probe an existing hub, spawn a fresh one, clean up stale PID files.
 *  The hub runs as a detached background process so it survives the CLI command that started it.
 */
import { spawn } from "child_process";
import { createRequire } from "module";
import * as fs from "fs";
import { duoHome, hubPidPath } from "@duo/shared";

const require = createRequire(import.meta.url);

export interface HubInfo {
  url: string;
  port: number;
  spawned: boolean;
}

async function probe(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

function readPidFile(): { pid: number; port: number } | null {
  try {
    return JSON.parse(fs.readFileSync(hubPidPath(), "utf8")) as { pid: number; port: number };
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Ensure a hub is running on `port`; reuse if healthy, else spawn one. */
export async function ensureHub(port: number): Promise<HubInfo> {
  if (await probe(port)) {
    return { url: `http://127.0.0.1:${port}`, port, spawned: false };
  }

  // Stale PID file for a dead process? Clean it.
  const existing = readPidFile();
  if (existing && !processAlive(existing.pid)) {
    try {
      fs.unlinkSync(hubPidPath());
    } catch {
      /* ignore */
    }
  }

  const hubEntry = require.resolve("@duo/hub");
  fs.mkdirSync(duoHome(), { recursive: true });
  const logFd = fs.openSync(`${duoHome()}/hub.log`, "a");

  const child = spawn(process.execPath, [hubEntry, "--port", String(port)], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });
  child.unref();

  // Wait for readiness.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await probe(port)) {
      return { url: `http://127.0.0.1:${port}`, port, spawned: true };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Hub did not become healthy on port ${port} within 10s. Check ${duoHome()}/hub.log`);
}

/** Stop the hub daemon by PID (best-effort). */
export function stopHub(): boolean {
  const info = readPidFile();
  if (!info) return false;
  try {
    process.kill(info.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  try {
    fs.unlinkSync(hubPidPath());
  } catch {
    /* ignore */
  }
  return true;
}

export async function hubReachable(port: number): Promise<boolean> {
  return probe(port);
}

/** Phase 2 coordination server lifecycle, owned by the desktop app.
 *
 *  Same shape as the hub: probe the port first and attach to whatever is already
 *  there (a `npm run coord` session, or another instance), otherwise boot one
 *  in-process and own it. Electron is what makes this cheap — the coordination
 *  server is a plain Node library, so there is no sidecar binary to ship or
 *  supervise, and it serves its own dashboard, so there is no Next.js process either.
 *
 *  Deliberately free of any `electron` import so it can be smoke-tested under plain
 *  node, which is the only way to check the NestJS boot path without a GUI.
 */
import "reflect-metadata";
import { DEFAULT_SERVER_PORT } from "@duo/coord-client";

export interface CoordinationHandle {
  /** Loopback URL for this app's own window. */
  url: string;
  /** False when we attached to a server someone else started — we must not stop it. */
  owned: boolean;
  /** True when the server is also serving the dashboard UI. */
  hasDashboard: boolean;
  stop(): Promise<void>;
}

const NOOP_STOP = async (): Promise<void> => undefined;

export function coordinationPort(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.COORD_PORT);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SERVER_PORT;
}

/** A DEPLOYED backend to connect to instead of running one locally.
 *
 *  For a distributed app (share the build with investors/team), set this to the
 *  deployed URL before `npm run dist`, or pass BROCODE_COORD_URL at runtime. When
 *  set, the app runs no local server — it opens the deployed coordination
 *  dashboard directly, so every copy joins the same shared session. Empty = the
 *  original local behaviour (probe-or-own on localhost). */
const DEFAULT_REMOTE_COORD_URL = "";

export function remoteCoordinationUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.BROCODE_COORD_URL ?? "").trim() || DEFAULT_REMOTE_COORD_URL;
  return raw.replace(/\/$/, "");
}

async function probe(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Does the server at this port serve a dashboard? Only meaningful when attaching. */
async function probeDashboard(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
    return res.ok && (res.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}

/** Attach to a running coordination server, or start one in-process. */
export async function ensureCoordination(port = coordinationPort()): Promise<CoordinationHandle> {
  // Deployed backend: connect out, run nothing locally. The remote serves the
  // dashboard (we stage it into the image), so hasDashboard is true.
  const remote = remoteCoordinationUrl();
  if (remote) {
    return { url: remote, owned: false, hasDashboard: true, stop: NOOP_STOP };
  }

  const url = `http://127.0.0.1:${port}`;

  if (await probe(port)) {
    return { url, owned: false, hasDashboard: await probeDashboard(port), stop: NOOP_STOP };
  }

  // Imported lazily: NestJS is a heavy graph, and a desktop user who never opens a
  // BroCode session should not pay for it at startup.
  const { createCoordinationApp, dashboardDir } = await import("@duo/coord-server");

  const nest = await createCoordinationApp();
  // 0.0.0.0, not localhost: the whole point is that the second machine can reach it.
  await nest.listen(port, process.env.COORD_HOST ?? "0.0.0.0");

  return { url, owned: true, hasDashboard: dashboardDir() !== null, stop: () => nest.close() };
}

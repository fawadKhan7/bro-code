/** Boots the coordination server, including the dashboard it serves.
 *
 *  One process, two surfaces: the WebSocket gateway and the static dashboard. Doing
 *  it this way means the second machine installs nothing — they open
 *  `http://<this-host>:4141` in a browser and they are in. It also lets the desktop
 *  app own the whole coordination layer without supervising a Next.js child process.
 *
 *  Shared by `main.ts` (CLI) and the Electron app, so both get identical behaviour.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";

/** dist/bootstrap.js → ../dashboard, the staged static export. Absent until
 *  `npm run build:coord:dashboard` has run; the server still works without it. */
export function dashboardDir(): string | null {
  const dir = path.join(__dirname, "..", "dashboard");
  return fs.existsSync(path.join(dir, "index.html")) ? dir : null;
}

export interface CreateOptions {
  /** Silence Nest's boot logging (tests, embedded use). */
  quiet?: boolean;
}

export async function createCoordinationApp(options: CreateOptions = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: { origin: true, credentials: true },
    ...(options.quiet ? { logger: false } : {}),
  });
  app.enableShutdownHooks();

  const dir = dashboardDir();
  if (dir) {
    // express.static only answers for files that exist, so /health and the socket.io
    // upgrade path fall through to their own handlers untouched.
    app.useStaticAssets(dir);
  }
  return app;
}

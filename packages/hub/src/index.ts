#!/usr/bin/env node
/** Hub bin entry: `duo-hub [--port N]`. The CLI (phase 2) spawns this. */
import * as fs from "fs";
import { duoHome, hubPidPath } from "@duo/shared";
import { Hub } from "./server.js";

export { Hub, type HubOptions } from "./server.js";
export { SessionStore, type CreateSessionInput, type PlanApprovalEdits } from "./store.js";
export { createToolset } from "./tools.js";

const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("duo-hub");

if (isMain) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 3131;

  const hub = new Hub({ port });
  hub
    .start()
    .then(() => {
      fs.mkdirSync(duoHome(), { recursive: true });
      fs.writeFileSync(hubPidPath(), JSON.stringify({ pid: process.pid, port: hub.port }), "utf8");
      // Single structured line so a spawning CLI can parse readiness.
      console.log(JSON.stringify({ ready: true, port: hub.port, url: hub.url }));
    })
    .catch((err) => {
      console.error(JSON.stringify({ ready: false, error: String(err) }));
      process.exit(1);
    });

  const shutdown = () => {
    void hub.stop().then(() => {
      try {
        fs.unlinkSync(hubPidPath());
      } catch {
        /* ignore */
      }
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

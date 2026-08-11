import "reflect-metadata";
import * as os from "node:os";
import { Logger } from "@nestjs/common";
import { DEFAULT_SERVER_PORT } from "@duo/coord-client";
import { createCoordinationApp, dashboardDir } from "./bootstrap.js";

/** Every LAN address this machine answers on — the other human needs one of these. */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

async function bootstrap(): Promise<void> {
  // PORT is injected by most hosts (Render, Railway, Fly, Cloud Run); COORD_PORT
  // stays as the local/LAN override; DEFAULT_SERVER_PORT is the last resort.
  const port = Number(process.env.PORT ?? process.env.COORD_PORT ?? DEFAULT_SERVER_PORT);
  // 0.0.0.0 so the second machine on the LAN can reach us; localhost-only would
  // make the whole two-machine premise impossible.
  const host = process.env.COORD_HOST ?? "0.0.0.0";

  const app = await createCoordinationApp();
  await app.listen(port, host);

  const log = new Logger("BroCode");
  const hasDashboard = dashboardDir() !== null;
  log.log(`coordination server listening on ${host}:${port}`);
  for (const address of lanAddresses()) {
    log.log(`  ${hasDashboard ? "open" : "reachable at"} http://${address}:${port}`);
  }
  if (!hasDashboard) {
    log.warn("dashboard not staged — run `npm run build:coord:dashboard` to serve it from here");
  }
  if (process.env.COORD_ALLOW_NETWORK_OVERRIDE === "1") {
    log.warn("COORD_ALLOW_NETWORK_OVERRIDE=1 — clients may name their own network group (dev only)");
  }
}

void bootstrap();

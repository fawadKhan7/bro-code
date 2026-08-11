/** Stages the static export into the coordination server package, so the server can
 *  serve the dashboard itself and ship it inside the packaged desktop app.
 *
 *  Mirrors how the Phase 1 hub bundles its own dashboard.
 */
import { cp, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../out/", import.meta.url));
const to = fileURLToPath(new URL("../../coord-server/dashboard/", import.meta.url));

try {
  await access(from);
} catch {
  console.error(`no export at ${from} — run \`next build\` first`);
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
console.log(`staged dashboard → ${to}`);

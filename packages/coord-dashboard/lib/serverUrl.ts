/** Where the dashboard's socket.io client connects.
 *
 *  Same-origin is right for the all-in-one cases (the coord-server serves this
 *  page itself, and the Electron app on localhost). For a split deploy — this
 *  frontend on Vercel, the backend on Koyeb/etc — set NEXT_PUBLIC_COORD_URL to
 *  the backend's public URL at build time; Next inlines it into the bundle.
 */
import { DEFAULT_SERVER_PORT } from "@duo/coord-client";

/** The build-time-configured backend URL, or "" when unset. */
export function configuredServerUrl(): string {
  return (process.env.NEXT_PUBLIC_COORD_URL ?? "").trim().replace(/\/$/, "");
}

/** The default the JoinForm pre-fills: configured backend, else the LAN heuristic. */
export function defaultServerUrl(): string {
  const configured = configuredServerUrl();
  if (configured) return configured;
  if (typeof window === "undefined") return `http://localhost:${DEFAULT_SERVER_PORT}`;
  return `http://${window.location.hostname}:${DEFAULT_SERVER_PORT}`;
}

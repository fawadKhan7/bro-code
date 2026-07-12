/** The hub server: one Node http server carrying all surfaces.
 *  /mcp (streamable HTTP, primary) · /sse + /message (legacy MCP, compat)
 *  /health + /api/* (REST control) · /api/updates (SSE events)
 */
import * as http from "http";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { sessionPath } from "@duo/shared";
import { SessionStore } from "./store.js";
import { RestApi } from "./rest.js";
import { LegacySseTransport } from "./legacySse.js";
import { handleMcpRequest } from "./mcpTransport.js";
import { SessionSupervisor, defaultAdapterResolver, type AdapterResolver } from "./supervisor.js";

/** dist/server.js → ../dashboard/index.html (bundled via package "files"). Read once, cached. */
function loadDashboard(): string | null {
  try {
    const file = fileURLToPath(new URL("../dashboard/index.html", import.meta.url));
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
let dashboardHtml: string | null | undefined;

export interface HubOptions {
  port?: number;
  host?: string;
  /** Session persistence file. Defaults to ~/.duo/session.json (DUO_HOME-aware). */
  persistFile?: string;
  /** Restore a persisted active session on boot (hub restart recovery). Default true. */
  restore?: boolean;
  /** Injectable adapter resolver — tests pass scripted adapters (no AI tokens). */
  adapterResolver?: AdapterResolver;
}

export class Hub {
  readonly store: SessionStore;
  readonly supervisor: SessionSupervisor;
  private server: http.Server | null = null;
  private rest: RestApi | null = null;
  private legacy: LegacySseTransport | null = null;
  private boundPort = 0;

  constructor(private options: HubOptions = {}) {
    this.store = new SessionStore(options.persistFile ?? sessionPath());
    if (options.restore !== false) this.store.loadFromDisk();
    this.supervisor = new SessionSupervisor(this.store, options.adapterResolver ?? defaultAdapterResolver);
  }

  get port(): number {
    return this.boundPort;
  }

  get url(): string {
    return `http://127.0.0.1:${this.boundPort}`;
  }

  start(): Promise<void> {
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 3131;

    this.legacy = new LegacySseTransport(this.store);

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.route(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          } else {
            res.end();
          }
        });
      });
      this.server.on("error", reject);
      this.server.listen(port, host, () => {
        const addr = this.server!.address();
        this.boundPort = typeof addr === "object" && addr ? addr.port : port;
        this.rest = new RestApi(this.store, this.boundPort, this.supervisor, this.url);
        resolve();
      });
    });
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Accept, Last-Event-ID");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlPath = (req.url ?? "").split("?")[0];

    if (urlPath === "/mcp") {
      await handleMcpRequest(this.store, req, res);
      return;
    }
    if (req.method === "GET" && urlPath === "/sse") {
      this.legacy!.handleSse(req, res, this.url);
      return;
    }
    if (req.method === "POST" && urlPath === "/message") {
      await this.legacy!.handleMessage(req, res);
      return;
    }

    if (this.rest && (await this.rest.handle(req, res, urlPath))) return;

    // Dashboard (static single page).
    if (req.method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
      if (dashboardHtml === undefined) dashboardHtml = loadDashboard();
      if (dashboardHtml) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(dashboardHtml);
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Not found: ${req.method} ${urlPath}` }));
  }

  async stop(): Promise<void> {
    await this.supervisor.stopAgents().catch(() => undefined);
    this.rest?.closeAll();
    this.legacy?.closeAll();
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      // SSE keep-alives would otherwise hold the server open.
      this.server.closeAllConnections?.();
    });
  }
}

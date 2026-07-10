/** MCP legacy HTTP+SSE transport (compat) — ported from the gen-1 extension server.
 *  Kept for MCP clients that predate streamable HTTP. Fronts the same toolset.
 *  Protocol: GET /sse → `endpoint` event → client POSTs JSON-RPC to /message?clientId=N;
 *  responses are written to the SSE stream, the POST returns 202.
 */
import type { IncomingMessage, ServerResponse } from "http";
import type { SessionStore } from "./store.js";
export declare class LegacySseTransport {
    private clients;
    private counter;
    private toolset;
    private toolByName;
    constructor(store: SessionStore);
    handleSse(req: IncomingMessage, res: ServerResponse, baseUrl: string): void;
    handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void>;
    closeAll(): void;
    private dispatch;
}
//# sourceMappingURL=legacySse.d.ts.map
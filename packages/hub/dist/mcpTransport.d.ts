/** MCP streamable HTTP transport (primary) — official SDK, stateless mode.
 *  A fresh McpServer+transport pair per request keeps the hub free of MCP session
 *  bookkeeping; all real state lives in the SessionStore. Long-poll tools work because
 *  the HTTP response is simply held until the handler's promise resolves.
 */
import type { IncomingMessage, ServerResponse } from "http";
import type { SessionStore } from "./store.js";
export declare function handleMcpRequest(store: SessionStore, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=mcpTransport.d.ts.map
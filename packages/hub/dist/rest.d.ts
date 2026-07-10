/** REST control surface + SSE event stream — the CLI's and dashboard's API.
 *  Not MCP. Everything here is a thin, validated pass-through to the SessionStore.
 */
import type { IncomingMessage, ServerResponse } from "http";
import type { SessionStore } from "./store.js";
export declare class RestApi {
    private store;
    private port;
    private subscribers;
    constructor(store: SessionStore, port: number);
    private broadcast;
    closeAll(): void;
    /** Returns true if the request was handled. */
    handle(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean>;
}
//# sourceMappingURL=rest.d.ts.map
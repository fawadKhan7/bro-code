import { SessionStore } from "./store.js";
export interface HubOptions {
    port?: number;
    host?: string;
    /** Session persistence file. Defaults to ~/.duo/session.json (DUO_HOME-aware). */
    persistFile?: string;
    /** Restore a persisted active session on boot (hub restart recovery). Default true. */
    restore?: boolean;
}
export declare class Hub {
    private options;
    readonly store: SessionStore;
    private server;
    private rest;
    private legacy;
    private boundPort;
    constructor(options?: HubOptions);
    get port(): number;
    get url(): string;
    start(): Promise<void>;
    private route;
    stop(): Promise<void>;
}
//# sourceMappingURL=server.d.ts.map
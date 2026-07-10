/** The agent-facing MCP tool catalog — transport-agnostic.
 *  Both the streamable-HTTP (SDK) and legacy-SSE transports front these same handlers.
 *  Cheap structured rejections, never hangs (long-polls always time out with retry:true).
 */
import { z } from "zod";
import type { SessionStore } from "./store.js";
/** Default long-poll hold; DUO_LONGPOLL_MS overrides (tests use short values). */
export declare function longPollMs(): number;
export interface ToolDef {
    name: string;
    description: string;
    /** zod raw shape — the SDK derives JSON schema from this. */
    shape: z.ZodRawShape;
    handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}
export declare function createToolset(store: SessionStore): ToolDef[];
/** Uniform result envelope for MCP text content. */
export declare function toTextResult(value: unknown): {
    content: Array<{
        type: "text";
        text: string;
    }>;
};
//# sourceMappingURL=tools.d.ts.map
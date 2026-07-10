export declare const CONDUCTOR_TOOL_SCHEMAS: readonly [{
    readonly name: "get_contract";
    readonly description: "Returns contract updates from the other agent since sinceVersion. Use before starting work that depends on peer output.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly agent_id: {
                readonly type: "string";
                readonly description: "Your agent id: agent-a or agent-b";
            };
            readonly sinceVersion: {
                readonly type: "number";
                readonly description: "Last version you processed. Omit or 0 for all updates.";
            };
        };
        readonly required: readonly ["agent_id"];
    };
}, {
    readonly name: "post_update";
    readonly description: "Publish a structured update the other agent depends on.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly from: {
                readonly type: "string";
                readonly description: "agent-a or agent-b";
            };
            readonly type: {
                readonly type: "string";
                readonly description: "e.g. endpoint, schema, ui, event";
            };
            readonly summary: {
                readonly type: "string";
                readonly description: "One-line summary";
            };
            readonly diff: {
                readonly type: "object";
                readonly properties: {
                    readonly added: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly removed: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly changed: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                };
            };
            readonly refs: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly description: "File paths relative to project root for the peer to open";
            };
        };
        readonly required: readonly ["from", "type", "summary"];
    };
}, {
    readonly name: "post_checkpoint";
    readonly description: "Signal a major milestone; session pauses until user runs conductor feedback.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly agent_id: {
                readonly type: "string";
                readonly description: "agent-a or agent-b";
            };
            readonly summary: {
                readonly type: "string";
                readonly description: "What was completed";
            };
            readonly next_step: {
                readonly type: "string";
                readonly description: "What you plan next";
            };
        };
        readonly required: readonly ["agent_id", "summary", "next_step"];
    };
}, {
    readonly name: "get_resume_brief";
    readonly description: "After checkpoint resume, returns condensed context. Call once after user feedback.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly agent_id: {
                readonly type: "string";
                readonly description: "agent-a or agent-b";
            };
        };
        readonly required: readonly ["agent_id"];
    };
}, {
    readonly name: "get_status";
    readonly description: "Session status, peer checkpoints, and latest contract version.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly agent_id: {
                readonly type: "string";
                readonly description: "Optional: agent-a or agent-b for peer-focused view";
            };
        };
    };
}];

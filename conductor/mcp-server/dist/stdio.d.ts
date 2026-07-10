/** MCP stdio transport: Content-Length framed JSON-RPC messages. */
export declare function writeMessage(msg: object): void;
export declare function createStdioReader(onMessage: (msg: Record<string, unknown>) => void): void;

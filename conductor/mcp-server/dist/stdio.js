"use strict";
/** MCP stdio transport: Content-Length framed JSON-RPC messages. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeMessage = writeMessage;
exports.createStdioReader = createStdioReader;
function writeMessage(msg) {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
    process.stdout.write(header + body);
}
function createStdioReader(onMessage) {
    let buffer = Buffer.alloc(0);
    process.stdin.on("readable", () => {
        const chunk = process.stdin.read();
        if (!chunk)
            return;
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1)
                return;
            const headerText = buffer.slice(0, headerEnd).toString("utf8");
            const match = /Content-Length:\s*(\d+)/i.exec(headerText);
            if (!match) {
                buffer = buffer.slice(headerEnd + 4);
                continue;
            }
            const length = parseInt(match[1], 10);
            const bodyStart = headerEnd + 4;
            if (buffer.length < bodyStart + length)
                return;
            const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
            buffer = buffer.slice(bodyStart + length);
            try {
                onMessage(JSON.parse(body));
            }
            catch {
                /* ignore malformed */
            }
        }
    });
}
//# sourceMappingURL=stdio.js.map
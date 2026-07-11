import * as path from "path";

export function mcpConfigSnippet(mcpServerEntry: string): string {
  const normalized = mcpServerEntry.replace(/\\/g, "/");
  return JSON.stringify(
    {
      mcpServers: {
        conductor: {
          command: "node",
          args: [normalized],
        },
      },
    },
    null,
    2
  );
}

export function defaultMcpServerPath(): string {
  return path.resolve(__dirname, "../../mcp-server/dist/index.js");
}

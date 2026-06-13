import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createCliRunner } from "./cli.js";
import { loadConfig } from "./config.js";
import type { ToolContext } from "./tools/util.js";
import { registerContainerTools } from "./tools/containers.js";
import { registerImageTools } from "./tools/images.js";
import { registerSystemTools } from "./tools/system.js";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
export const VERSION: string = pkg.version;

export function createServer(overrides: Partial<ToolContext> = {}): McpServer {
  const sessionId = overrides.sessionId ?? randomUUID();
  const server = new McpServer({ name: "container-mcp", version: VERSION });
  const ctx: ToolContext = {
    run: overrides.run ?? createCliRunner(),
    config: overrides.config ?? loadConfig(),
    sessionId,
    getClient: overrides.getClient ?? (() => server.server.getClientVersion()?.name ?? "unknown"),
  };
  registerContainerTools(server, ctx);
  registerImageTools(server, ctx);
  registerSystemTools(server, ctx);
  return server;
}

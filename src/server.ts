import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createCliRunner } from "./cli.js";
import { loadConfig } from "./config.js";
import type { ToolContext } from "./tools/util.js";
import { registerContainerTools } from "./tools/containers.js";
import { registerImageTools } from "./tools/images.js";
import { registerSystemTools } from "./tools/system.js";

export const VERSION = "0.1.0";

export function createServer(overrides: Partial<ToolContext> = {}): McpServer {
  const ctx: ToolContext = {
    run: overrides.run ?? createCliRunner(),
    config: overrides.config ?? loadConfig(),
  };
  const server = new McpServer({ name: "container-mcp", version: VERSION });
  registerContainerTools(server, ctx);
  registerImageTools(server, ctx);
  registerSystemTools(server, ctx);
  return server;
}

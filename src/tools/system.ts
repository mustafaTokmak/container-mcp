import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, fail, type ToolContext } from "./util.js";
import { ensureWritable } from "../safety.js";

export function registerSystemTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "system_status",
    {
      title: "Container system status",
      description:
        "Check whether the Apple container system service is running. " +
        "Pass start: true to start it if it is stopped.",
      inputSchema: {
        start: z.boolean().optional().describe("Start the service if it is not running"),
      },
    },
    async ({ start }) => {
      try {
        const status = await ctx.run(["system", "status"]);
        return ok(status.stdout.trim() || "running");
      } catch (err) {
        if (!start) return fail(err);
        try {
          ensureWritable(ctx.config, "starting the system service");
          await ctx.run(["system", "start"]);
          return ok("container system service started");
        } catch (startErr) {
          return fail(startErr);
        }
      }
    }
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, fail, type ToolContext } from "./util.js";
import { assertSafeCliValue } from "../safety.js";

export function registerContainerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_containers",
    {
      title: "List containers",
      description: "List containers as JSON. Pass all: true to include stopped containers.",
      inputSchema: { all: z.boolean().optional().describe("Include stopped containers") },
      annotations: { readOnlyHint: true },
    },
    async ({ all }) => {
      try {
        const args = ["list", "--format", "json"];
        if (all) args.push("--all");
        const res = await ctx.run(args);
        return ok(res.stdout.trim() || "[]");
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "container_logs",
    {
      title: "Container logs",
      description: "Fetch the most recent log lines from a container (default: last 100).",
      inputSchema: {
        id: z.string().describe("Container ID or name"),
        tail: z.number().int().positive().max(1000).optional().describe("Number of lines (default 100)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, tail }) => {
      try {
        const safeId = assertSafeCliValue(id, "container id");
        const res = await ctx.run(["logs", safeId]);
        const lines = res.stdout.replace(/\n$/, "").split("\n");
        return ok(lines.slice(-(tail ?? 100)).join("\n"));
      } catch (err) {
        return fail(err);
      }
    }
  );
}

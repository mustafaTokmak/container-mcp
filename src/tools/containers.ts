import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, fail, type ToolContext } from "./util.js";
import { assertSafeCliValue, ensureWritable, validateHostPath, SafetyError } from "../safety.js";
import { MANAGED_LABEL, AGENT_LABEL_KEY } from "../config.js";

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

  server.registerTool(
    "run_container",
    {
      title: "Run container",
      description:
        "Run a container in the background inside its own lightweight VM and return its ID. " +
        "Mount sources must be inside the allowed host paths. " +
        "Default CPU/memory limits are applied unless overridden.",
      inputSchema: {
        image: z.string().describe("Image reference, e.g. alpine:latest"),
        name: z.string().optional().describe("Optional container name"),
        command: z.array(z.string()).optional().describe("Command and arguments to run"),
        mounts: z
          .array(
            z.object({
              source: z.string().describe("Host path (must be inside an allowed root)"),
              destination: z.string().describe("Path inside the container"),
              readonly: z.boolean().optional(),
            })
          )
          .optional(),
        cpus: z.string().optional().describe("CPU limit, e.g. '4'"),
        memory: z.string().optional().describe("Memory limit, e.g. '4g'"),
        env: z
          .record(z.string().regex(/^[^=\-][^=]*$/, "invalid env variable name"), z.string())
          .optional()
          .describe("Environment variables"),
      },
    },
    async ({ image, name, command, mounts, cpus, memory, env }) => {
      try {
        ensureWritable(ctx.config, "run_container");
        const safeImage = assertSafeCliValue(image, "image reference");
        const safeCpus = assertSafeCliValue(cpus ?? ctx.config.defaultCpus, "cpus");
        const safeMemory = assertSafeCliValue(memory ?? ctx.config.defaultMemory, "memory");
        const args = [
          "run",
          "--detach",
          "--cpus",
          safeCpus,
          "--memory",
          safeMemory,
          "--label",
          MANAGED_LABEL,
          "--label",
          `${AGENT_LABEL_KEY}=${ctx.config.agentName}`,
        ];
        if (name) args.push("--name", assertSafeCliValue(name, "container name"));
        for (const m of mounts ?? []) {
          if (!m.destination.startsWith("/") || m.destination.includes(":")) {
            throw new SafetyError(`Invalid mount destination: ${JSON.stringify(m.destination)}`);
          }
          const source = validateHostPath(m.source, ctx.config);
          args.push("--volume", `${source}:${m.destination}${m.readonly ? ":ro" : ""}`);
        }
        for (const [key, value] of Object.entries(env ?? {})) {
          if (/^-|=/.test(key)) {
            throw new SafetyError(`Invalid env variable name: ${JSON.stringify(key)}`);
          }
          args.push("--env", `${key}=${value}`);
        }
        args.push(safeImage, ...(command ?? []));
        const res = await ctx.run(args);
        return ok(res.stdout.trim());
      } catch (err) {
        return fail(err);
      }
    }
  );
}

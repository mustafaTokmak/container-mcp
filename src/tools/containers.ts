import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, fail, type ToolContext } from "./util.js";
import { assertSafeCliValue, ensureWritable, validateHostPath, validateExistingHostPath, SafetyError } from "../safety.js";
import { MANAGED_LABEL, AGENT_LABEL_KEY } from "../config.js";

const isContainerPath = (p: string) => /^[^/:]+:/.test(p);

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
      description: "Fetch the most recent log lines from a container (default: last 100). The tail is applied server-side via the CLI -n flag.",
      inputSchema: {
        id: z.string().describe("Container ID or name"),
        tail: z.number().int().positive().max(1000).optional().describe("Number of lines (default 100)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, tail }) => {
      try {
        const safeId = assertSafeCliValue(id, "container id");
        const res = await ctx.run(["logs", "-n", String(tail ?? 100), safeId]);
        return ok(res.stdout.trimEnd());
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
        "Run a container inside its own lightweight VM. " +
        "By default runs detached and returns the container ID. " +
        "Pass wait: true to run to completion and return the container's output (10 minute limit). " +
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
        workdir: z.string().optional().describe("Working directory inside the container"),
        wait: z.boolean().optional().describe("Run to completion and return the container's output instead of its ID (10 minute limit)"),
      },
    },
    async ({ image, name, command, mounts, cpus, memory, env, workdir, wait }) => {
      try {
        ensureWritable(ctx.config, "run_container");

        // Container-count cap. Each Apple container is a full VM — an unbounded count
        // can exhaust the machine. The cap is a resource guard, not a security boundary.
        const listRes = await ctx.run(["list", "--format", "json"]);
        let parsed: unknown;
        try { parsed = JSON.parse(listRes.stdout); } catch { parsed = null; }
        if (Array.isArray(parsed) && parsed.length >= ctx.config.maxContainers) {
          return fail(
            `Container limit reached (${parsed.length} running, max ${ctx.config.maxContainers}). ` +
            `Stop or remove one (stop_container / remove_container), or raise CONTAINER_MCP_MAX_CONTAINERS.`
          );
        }

        const safeImage = assertSafeCliValue(image, "image reference");
        const safeCpus = assertSafeCliValue(cpus ?? ctx.config.defaultCpus, "cpus");
        const safeMemory = assertSafeCliValue(memory ?? ctx.config.defaultMemory, "memory");
        if (command?.length) assertSafeCliValue(command[0], "command");
        const args = ["run"];
        if (!wait) args.push("--detach");
        args.push(
          "--cpus",
          safeCpus,
          "--memory",
          safeMemory,
          "--label",
          MANAGED_LABEL,
          "--label",
          `${AGENT_LABEL_KEY}=${ctx.config.agentName}`,
        );
        if (workdir) args.push("--workdir", assertSafeCliValue(workdir, "workdir"));
        if (name) args.push("--name", assertSafeCliValue(name, "container name"));
        for (const m of mounts ?? []) {
          if (!m.destination.startsWith("/") || m.destination.includes(":")) {
            throw new SafetyError(`Invalid mount destination: ${JSON.stringify(m.destination)}`);
          }
          const source = validateExistingHostPath(m.source, ctx.config);
          args.push("--volume", `${source}:${m.destination}${m.readonly ? ":ro" : ""}`);
        }
        for (const [key, value] of Object.entries(env ?? {})) {
          if (/^-|=/.test(key)) {
            throw new SafetyError(`Invalid env variable name: ${JSON.stringify(key)}`);
          }
          args.push("--env", `${key}=${value}`);
        }
        args.push(safeImage, ...(command ?? []));
        if (wait) {
          const res = await ctx.run(args, { timeoutMs: 600_000 });
          return ok(res.stdout.trim() || "(no output)");
        }
        const res = await ctx.run(args);
        return ok(res.stdout.trim());
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "stop_container",
    {
      title: "Stop container",
      description: "Stop a running container.",
      inputSchema: { id: z.string().describe("Container ID or name") },
    },
    async ({ id }) => {
      try {
        ensureWritable(ctx.config, "stop_container");
        const safeId = assertSafeCliValue(id, "container id");
        await ctx.run(["stop", safeId]);
        return ok(`stopped ${safeId}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "remove_container",
    {
      title: "Remove container",
      description: "Delete a container. Pass force: true to delete a running container.",
      inputSchema: {
        id: z.string().describe("Container ID or name"),
        force: z.boolean().optional().describe("Force-delete even if running"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id, force }) => {
      try {
        ensureWritable(ctx.config, "remove_container");
        const safeId = assertSafeCliValue(id, "container id");
        const args = ["delete"];
        if (force) args.push("--force");
        args.push(safeId);
        await ctx.run(args);
        return ok(`removed ${safeId}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "exec_in_container",
    {
      title: "Execute in container",
      description: "Run a command inside a running container and return its output.",
      inputSchema: {
        id: z.string().describe("Container ID or name"),
        command: z.array(z.string()).min(1).describe("Command and arguments"),
      },
    },
    async ({ id, command }) => {
      try {
        ensureWritable(ctx.config, "exec_in_container");
        const safeId = assertSafeCliValue(id, "container id");
        const res = await ctx.run(["exec", safeId, "--", ...command]);
        return ok(res.stdout.trim());
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "copy_files",
    {
      title: "Copy files",
      description:
        "Copy files between host and container. Container paths use '<id>:<path>'. " +
        "Host paths must be inside the allowed roots.",
      inputSchema: {
        source: z.string().describe("Source path (host path or <id>:<path>)"),
        destination: z.string().describe("Destination path (host path or <id>:<path>)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ source, destination }) => {
      try {
        ensureWritable(ctx.config, "copy_files");
        const src = isContainerPath(source)
          ? assertSafeCliValue(source, "source path")
          : validateExistingHostPath(source, ctx.config);
        const dst = isContainerPath(destination)
          ? assertSafeCliValue(destination, "destination path")
          : validateHostPath(destination, ctx.config);
        await ctx.run(["cp", src, dst]);
        return ok(`copied ${source} -> ${destination}`);
      } catch (err) {
        return fail(err);
      }
    }
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, fail, type ToolContext } from "./util.js";
import { ensureWritable, validateHostPath, validateExistingHostPath, assertSafeCliValue } from "../safety.js";

export function registerImageTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_images",
    {
      title: "List images",
      description: "List local container images as JSON.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const res = await ctx.run(["image", "list", "--format", "json"]);
        return ok(res.stdout.trim() || "[]");
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "pull_image",
    {
      title: "Pull image",
      description: "Pull an OCI image from a registry, e.g. 'alpine:latest'.",
      inputSchema: { reference: z.string().min(1).describe("Image reference, e.g. alpine:latest") },
    },
    async ({ reference }) => {
      try {
        ensureWritable(ctx.config, "pull_image");
        const ref = assertSafeCliValue(reference, "image reference");
        const res = await ctx.run(["image", "pull", ref], { timeoutMs: 600_000 });
        return ok(res.stdout.trim() || `pulled ${ref}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "build_image",
    {
      title: "Build image",
      description:
        "Build an image from a Dockerfile. The build context must be inside an allowed host path.",
      inputSchema: {
        context: z.string().min(1).describe("Build context directory on the host"),
        tag: z.string().min(1).describe("Tag for the built image, e.g. myapp:dev"),
        dockerfile: z.string().min(1).optional().describe("Path to the Dockerfile (defaults to context/Dockerfile)"),
      },
    },
    async ({ context, tag, dockerfile }) => {
      try {
        ensureWritable(ctx.config, "build_image");
        const contextPath = validateExistingHostPath(context, ctx.config);
        const safeTag = assertSafeCliValue(tag, "image tag");
        const args = ["build", "--tag", safeTag];
        if (dockerfile) {
          args.push("--file", validateExistingHostPath(dockerfile, ctx.config));
        }
        args.push(contextPath);
        const res = await ctx.run(args, { timeoutMs: 600_000 });
        return ok(res.stdout.trim() || `built ${safeTag}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "remove_image",
    {
      title: "Remove image",
      description: "Delete a local image by reference. Pass force: true to remove even if in use.",
      inputSchema: {
        reference: z.string().min(1).describe("Image reference, e.g. alpine:latest"),
        force: z.boolean().optional().describe("Force removal"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ reference, force }) => {
      try {
        ensureWritable(ctx.config, "remove_image");
        const ref = assertSafeCliValue(reference, "image reference");
        const args = ["image", "delete"];
        if (force) args.push("--force");
        args.push(ref);
        const res = await ctx.run(args);
        return ok(res.stdout.trim() || `removed ${ref}`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "prune_images",
    {
      title: "Prune images",
      description: "Remove dangling images to reclaim disk. Pass all: true to remove all unused images.",
      inputSchema: { all: z.boolean().optional().describe("Remove all unused images, not just dangling") },
      annotations: { destructiveHint: true },
    },
    async ({ all }) => {
      try {
        ensureWritable(ctx.config, "prune_images");
        const args = ["image", "prune"];
        if (all) args.push("--all");
        const res = await ctx.run(args);
        return ok(res.stdout.trim() || "pruned");
      } catch (err) {
        return fail(err);
      }
    }
  );
}

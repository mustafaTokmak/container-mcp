import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerImageTools } from "../src/tools/images.js";
import { makeConfig, makeFakeRunner, makeServer, connect } from "./helpers.js";

function textOf(res: any): string {
  return res.content[0].text;
}

async function setup(results: any[] = [], cfgOverrides = {}) {
  const runner = makeFakeRunner(results);
  const server = makeServer();
  registerImageTools(server, {
    run: runner.run,
    config: makeConfig(cfgOverrides),
    sessionId: "test-session",
    getClient: () => "test-client",
  });
  const client = await connect(server);
  return { runner, client };
}

describe("list_images", () => {
  test("returns JSON output", async () => {
    const { runner, client } = await setup([{ stdout: '[{"name":"alpine"}]', stderr: "" }]);
    const res = await client.callTool({ name: "list_images", arguments: {} });
    expect(textOf(res)).toBe('[{"name":"alpine"}]');
    expect(runner.calls[0]).toEqual(["image", "list", "--format", "json"]);
  });
});

describe("pull_image", () => {
  test("pulls a reference", async () => {
    const { runner, client } = await setup([{ stdout: "done", stderr: "" }]);
    const res = await client.callTool({
      name: "pull_image",
      arguments: { reference: "alpine:latest" },
    });
    expect(textOf(res)).toBe("done");
    expect(runner.calls[0]).toEqual(["image", "pull", "alpine:latest"]);
    expect(runner.optsLog[0]).toEqual({ timeoutMs: 600_000 });
  });

  test("blocked in read-only mode", async () => {
    const { client } = await setup([], { readOnly: true });
    const res: any = await client.callTool({
      name: "pull_image",
      arguments: { reference: "alpine:latest" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Read-only/);
  });

  test("rejects a reference that looks like a flag", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "pull_image",
      arguments: { reference: "--help" },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });
});

describe("build_image", () => {
  test("builds with tag, validated context, and optional dockerfile", async () => {
    // Context and dockerfile must exist for validateExistingHostPath.
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmcp-build-")));
    const contextDir = path.join(root, "app");
    fs.mkdirSync(contextDir);
    const dockerfile = path.join(contextDir, "Dockerfile");
    fs.writeFileSync(dockerfile, "FROM scratch\n");
    try {
      const { runner, client } = await setup([{ stdout: "built", stderr: "" }], {
        allowedMounts: [root],
      });
      const res = await client.callTool({
        name: "build_image",
        arguments: {
          context: contextDir,
          tag: "myapp:dev",
          dockerfile,
        },
      });
      expect(textOf(res)).toBe("built");
      expect(runner.calls[0]).toEqual([
        "build",
        "--tag",
        "myapp:dev",
        "--file",
        dockerfile,
        contextDir,
      ]);
      expect(runner.optsLog[0]).toEqual({ timeoutMs: 600_000 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a build context outside allowed roots", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "build_image",
      arguments: { context: "/etc", tag: "evil:1" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not allowed/);
    expect(runner.calls.length).toBe(0);
  });

  test("rejects dockerfile outside allowed roots even if context is valid", async () => {
    // Context must exist and be allowed; dockerfile must exist but be outside the allowlist.
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmcp-df-")));
    const contextDir = path.join(root, "app");
    fs.mkdirSync(contextDir);
    try {
      const { runner, client } = await setup([], { allowedMounts: [root] });
      const res: any = await client.callTool({
        name: "build_image",
        // /etc/hosts is a real file on macOS/Linux, outside our root
        arguments: { context: contextDir, tag: "t:1", dockerfile: "/etc/hosts" },
      });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/not allowed/);
      expect(runner.calls.length).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("remove_image", () => {
  test("deletes an image", async () => {
    const { runner, client } = await setup([{ stdout: "removed", stderr: "" }]);
    const res = await client.callTool({
      name: "remove_image",
      arguments: { reference: "alpine:latest" },
    });
    expect(textOf(res)).toMatch(/removed/);
    expect(runner.calls[0]).toEqual(["image", "delete", "alpine:latest"]);
  });

  test("force flag", async () => {
    const { runner, client } = await setup([{ stdout: "", stderr: "" }]);
    const res = await client.callTool({
      name: "remove_image",
      arguments: { reference: "x:1", force: true },
    });
    expect(runner.calls[0]).toEqual(["image", "delete", "--force", "x:1"]);
  });

  test("blocked in read-only mode", async () => {
    const { runner, client } = await setup([], { readOnly: true });
    const res: any = await client.callTool({
      name: "remove_image",
      arguments: { reference: "alpine:latest" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Read-only/);
    expect(runner.calls.length).toBe(0);
  });

  test("rejects a flag-like reference", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "remove_image",
      arguments: { reference: "--all" },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });

  test("is annotated destructive", async () => {
    const { client } = await setup();
    const tools = await client.listTools();
    const removeTool = tools.tools.find((t) => t.name === "remove_image");
    expect(removeTool).toBeDefined();
    expect(removeTool?.annotations?.destructiveHint).toBe(true);
  });
});

describe("prune_images", () => {
  test("prunes dangling", async () => {
    const { runner, client } = await setup([{ stdout: "pruned", stderr: "" }]);
    const res = await client.callTool({
      name: "prune_images",
      arguments: {},
    });
    expect(textOf(res)).toMatch(/pruned/);
    expect(runner.calls[0]).toEqual(["image", "prune"]);
  });

  test("all flag", async () => {
    const { runner, client } = await setup([{ stdout: "", stderr: "" }]);
    const res = await client.callTool({
      name: "prune_images",
      arguments: { all: true },
    });
    expect(runner.calls[0]).toEqual(["image", "prune", "--all"]);
  });

  test("blocked in read-only mode", async () => {
    const { runner, client } = await setup([], { readOnly: true });
    const res: any = await client.callTool({
      name: "prune_images",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Read-only/);
    expect(runner.calls.length).toBe(0);
  });

  test("is annotated destructive", async () => {
    const { client } = await setup();
    const tools = await client.listTools();
    const pruneTool = tools.tools.find((t) => t.name === "prune_images");
    expect(pruneTool).toBeDefined();
    expect(pruneTool?.annotations?.destructiveHint).toBe(true);
  });
});

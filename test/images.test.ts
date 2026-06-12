import { describe, test, expect } from "vitest";
import { registerImageTools } from "../src/tools/images.js";
import { makeConfig, makeFakeRunner, makeServer, connect } from "./helpers.js";

function textOf(res: any): string {
  return res.content[0].text;
}

async function setup(results: any[] = [], cfgOverrides = {}) {
  const runner = makeFakeRunner(results);
  const server = makeServer();
  registerImageTools(server, { run: runner.run, config: makeConfig(cfgOverrides) });
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
    const { runner, client } = await setup([{ stdout: "built", stderr: "" }]);
    const res = await client.callTool({
      name: "build_image",
      arguments: {
        context: "/Users/me/proj/app",
        tag: "myapp:dev",
        dockerfile: "/Users/me/proj/app/Dockerfile",
      },
    });
    expect(textOf(res)).toBe("built");
    expect(runner.calls[0]).toEqual([
      "build",
      "--tag",
      "myapp:dev",
      "--file",
      "/Users/me/proj/app/Dockerfile",
      "/Users/me/proj/app",
    ]);
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
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "build_image",
      arguments: { context: "/Users/me/proj/app", tag: "t:1", dockerfile: "/etc/Dockerfile" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not allowed/);
    expect(runner.calls.length).toBe(0);
  });
});

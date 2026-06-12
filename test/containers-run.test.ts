import { describe, test, expect } from "vitest";
import { registerContainerTools } from "../src/tools/containers.js";
import { makeConfig, makeFakeRunner, makeServer, connect } from "./helpers.js";

function textOf(res: any): string {
  return res.content[0].text;
}

async function setup(results: any[] = [], cfgOverrides = {}) {
  const runner = makeFakeRunner(results);
  const server = makeServer();
  registerContainerTools(server, { run: runner.run, config: makeConfig(cfgOverrides) });
  const client = await connect(server);
  return { runner, client };
}

describe("run_container", () => {
  test("runs detached with default limits and management labels", async () => {
    const { runner, client } = await setup([{ stdout: "abc123\n", stderr: "" }]);
    const res = await client.callTool({
      name: "run_container",
      arguments: { image: "alpine:latest" },
    });
    expect(textOf(res)).toBe("abc123");
    expect(runner.calls[0]).toEqual([
      "run",
      "--detach",
      "--cpus",
      "2",
      "--memory",
      "2g",
      "--label",
      "dev.container-mcp.managed=true",
      "--label",
      "dev.container-mcp.agent=claude",
      "alpine:latest",
    ]);
  });

  test("applies name, command, env, and per-call limits", async () => {
    const { runner, client } = await setup([{ stdout: "id1", stderr: "" }]);
    await client.callTool({
      name: "run_container",
      arguments: {
        image: "node:20",
        name: "test-run",
        command: ["node", "-e", "console.log(1)"],
        cpus: "4",
        memory: "4g",
        env: { FOO: "bar" },
      },
    });
    const args = runner.calls[0];
    expect(args).toContain("--name");
    expect(args[args.indexOf("--name") + 1]).toBe("test-run");
    expect(args[args.indexOf("--cpus") + 1]).toBe("4");
    expect(args[args.indexOf("--memory") + 1]).toBe("4g");
    expect(args).toContain("--env");
    expect(args[args.indexOf("--env") + 1]).toBe("FOO=bar");
    expect(args.slice(-4)).toEqual(["node:20", "node", "-e", "console.log(1)"]);
  });

  test("mounts an allowed path, optionally read-only", async () => {
    const { runner, client } = await setup([{ stdout: "id2", stderr: "" }]);
    await client.callTool({
      name: "run_container",
      arguments: {
        image: "alpine",
        mounts: [
          { source: "/Users/me/proj/src", destination: "/work" },
          { source: "/tmp/cache", destination: "/cache", readonly: true },
        ],
      },
    });
    const args = runner.calls[0];
    const volumes = args.filter((_, i) => args[i - 1] === "--volume");
    expect(volumes).toEqual(["/Users/me/proj/src:/work", "/private/tmp/cache:/cache:ro"]);
  });

  test("rejects a mount outside the allowlist without calling the CLI", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "run_container",
      arguments: {
        image: "alpine",
        mounts: [{ source: "/etc", destination: "/host-etc" }],
      },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not allowed/);
    expect(runner.calls.length).toBe(0);
  });

  test("rejects an image that looks like a flag", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "--privileged" },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });

  test("blocked entirely in read-only mode", async () => {
    const { runner, client } = await setup([], { readOnly: true });
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "alpine" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Read-only/);
    expect(runner.calls.length).toBe(0);
  });

  test("rejects cpus/memory values that look like flags", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "alpine", cpus: "--network=host" },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });

  test("rejects a mount destination containing a colon", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "run_container",
      arguments: {
        image: "alpine",
        mounts: [{ source: "/Users/me/proj/src", destination: "/x:/y" }],
      },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Invalid mount destination/);
    expect(runner.calls.length).toBe(0);
  });

  test("rejects an env variable name containing '='", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "alpine", env: { "FOO=BAR": "x" } },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });
});

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerContainerTools } from "../src/tools/containers.js";
import { makeConfig, makeFakeRunner, makeServer, connect, MANAGED_INSPECT, UNMANAGED_INSPECT } from "./helpers.js";

function textOf(res: any): string {
  return res.content[0].text;
}

async function setup(results: any[] = [], cfgOverrides = {}) {
  const runner = makeFakeRunner(results);
  const server = makeServer();
  registerContainerTools(server, {
    run: runner.run,
    config: makeConfig(cfgOverrides),
    sessionId: "test-session",
    getClient: () => "test-client",
  });
  const client = await connect(server);
  return { runner, client };
}

describe("stop_container", () => {
  test("stops by id", async () => {
    const { runner, client } = await setup([MANAGED_INSPECT, { stdout: "", stderr: "" }]);
    const res = await client.callTool({ name: "stop_container", arguments: { id: "abc" } });
    expect(textOf(res)).toMatch(/stopped abc/);
    expect(runner.calls[0]).toEqual(["inspect", "abc"]);
    expect(runner.calls[1]).toEqual(["stop", "abc"]);
  });

  test("rejects a flag-like id", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({ name: "stop_container", arguments: { id: "--all" } });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });

  test("rejects an empty container id at the schema layer", async () => {
    const { runner, client } = await setup();
    const res: any = await client
      .callTool({ name: "stop_container", arguments: { id: "" } })
      .catch((e) => ({ isError: true, content: [{ type: "text", text: String(e) }] }));
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });
});

describe("remove_container", () => {
  test("deletes by id, with force flag", async () => {
    const { runner, client } = await setup([MANAGED_INSPECT, { stdout: "", stderr: "" }]);
    await client.callTool({ name: "remove_container", arguments: { id: "abc", force: true } });
    expect(runner.calls[0]).toEqual(["inspect", "abc"]);
    expect(runner.calls[1]).toEqual(["delete", "--force", "abc"]);
  });

  test("is annotated destructive", async () => {
    const { client } = await setup();
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "remove_container");
    expect(tool?.annotations?.destructiveHint).toBe(true);
  });
});

describe("exec_in_container", () => {
  test("execs a command vector", async () => {
    const { runner, client } = await setup([MANAGED_INSPECT, { stdout: "hi\n", stderr: "" }]);
    const res = await client.callTool({
      name: "exec_in_container",
      arguments: { id: "abc", command: ["echo", "hi"] },
    });
    expect(textOf(res)).toBe("hi");
    expect(runner.calls[0]).toEqual(["inspect", "abc"]);
    expect(runner.calls[1]).toEqual(["exec", "abc", "--", "echo", "hi"]);
  });

  test("blocked in read-only mode", async () => {
    const { client } = await setup([], { readOnly: true });
    const res: any = await client.callTool({
      name: "exec_in_container",
      arguments: { id: "abc", command: ["rm", "-rf", "/"] },
    });
    expect(res.isError).toBe(true);
  });
});

describe("copy_files", () => {
  test("copies host file into container, validating the host side", async () => {
    // Source must be a real, existing host file for validateExistingHostPath.
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmcp-cp-")));
    const srcFile = path.join(root, "a.txt");
    fs.writeFileSync(srcFile, "data");
    try {
      const { runner, client } = await setup([MANAGED_INSPECT, { stdout: "", stderr: "" }], {
        allowedMounts: [root],
      });
      await client.callTool({
        name: "copy_files",
        arguments: { source: srcFile, destination: "abc:/work/a.txt" },
      });
      expect(runner.calls[0]).toEqual(["inspect", "abc"]);
      expect(runner.calls[1]).toEqual(["cp", srcFile, "abc:/work/a.txt"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a host destination outside allowed roots", async () => {
    // Source is a container path: ensureManaged inspect passes (managed), then
    // destination host-path validation fails because /Users/me/other is outside the allowed roots.
    const { runner, client } = await setup([MANAGED_INSPECT]);
    const res: any = await client.callTool({
      name: "copy_files",
      arguments: { source: "abc:/etc/passwd", destination: "/Users/me/other/pw" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not allowed/);
    expect(runner.calls[0]).toEqual(["inspect", "abc"]);
  });

  test("rejects a relative host path that contains a colon", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "copy_files",
      arguments: { source: "weird/dir:file", destination: "/tmp/x" },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });

  test("enforces managed label on the container side of a container-to-host copy", async () => {
    const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cp-")));
    const { runner, client } = await setup([UNMANAGED_INSPECT], { allowedMounts: [real] });
    try {
      const res: any = await client.callTool({
        name: "copy_files",
        arguments: { source: "victim:/data", destination: path.join(real, "out") },
      });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/not managed/);
      expect(runner.calls).toEqual([["inspect", "victim"]]);
    } finally {
      fs.rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("managed-label enforcement", () => {
  test("refuses to stop an unmanaged container", async () => {
    const { runner, client } = await setup([UNMANAGED_INSPECT]);
    const res: any = await client.callTool({ name: "stop_container", arguments: { id: "victim" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/CONTAINER_MCP_ALLOW_UNMANAGED/);
    expect(runner.calls).toEqual([["inspect", "victim"]]);
  });

  test("refuses when inspect output is unrecognizable", async () => {
    const { runner, client } = await setup([{ stdout: "weird", stderr: "" }]);
    const res: any = await client.callTool({ name: "exec_in_container", arguments: { id: "x", command: ["ls"] } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not managed/);
  });

  test("accepts array-form labels", async () => {
    const arrayInspect = {
      stdout: JSON.stringify([{ labels: ["dev.container-mcp.managed=true"] }]),
      stderr: "",
    };
    const { runner, client } = await setup([arrayInspect, { stdout: "", stderr: "" }]);
    const res = await client.callTool({ name: "stop_container", arguments: { id: "abc" } });
    expect(textOf(res)).toMatch(/stopped abc/);
  });

  test("CONTAINER_MCP_ALLOW_UNMANAGED skips inspection entirely", async () => {
    const { runner, client } = await setup([{ stdout: "", stderr: "" }], { allowUnmanaged: true });
    await client.callTool({ name: "stop_container", arguments: { id: "abc" } });
    expect(runner.calls).toEqual([["stop", "abc"]]);
  });
});

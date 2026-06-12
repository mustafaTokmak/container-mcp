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

describe("stop_container", () => {
  test("stops by id", async () => {
    const { runner, client } = await setup([{ stdout: "", stderr: "" }]);
    const res = await client.callTool({ name: "stop_container", arguments: { id: "abc" } });
    expect(textOf(res)).toMatch(/stopped abc/);
    expect(runner.calls[0]).toEqual(["stop", "abc"]);
  });

  test("rejects a flag-like id", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({ name: "stop_container", arguments: { id: "--all" } });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });
});

describe("remove_container", () => {
  test("deletes by id, with force flag", async () => {
    const { runner, client } = await setup([{ stdout: "", stderr: "" }]);
    await client.callTool({ name: "remove_container", arguments: { id: "abc", force: true } });
    expect(runner.calls[0]).toEqual(["delete", "--force", "abc"]);
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
    const { runner, client } = await setup([{ stdout: "hi\n", stderr: "" }]);
    const res = await client.callTool({
      name: "exec_in_container",
      arguments: { id: "abc", command: ["echo", "hi"] },
    });
    expect(textOf(res)).toBe("hi");
    expect(runner.calls[0]).toEqual(["exec", "abc", "echo", "hi"]);
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
    const { runner, client } = await setup([{ stdout: "", stderr: "" }]);
    await client.callTool({
      name: "copy_files",
      arguments: { source: "/Users/me/proj/a.txt", destination: "abc:/work/a.txt" },
    });
    expect(runner.calls[0]).toEqual(["cp", "/Users/me/proj/a.txt", "abc:/work/a.txt"]);
  });

  test("rejects a host destination outside allowed roots", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "copy_files",
      arguments: { source: "abc:/etc/passwd", destination: "/Users/me/other/pw" },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });
});

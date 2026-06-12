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

describe("list_containers", () => {
  test("lists running containers as JSON", async () => {
    const { runner, client } = await setup([{ stdout: '[{"id":"abc"}]', stderr: "" }]);
    const res = await client.callTool({ name: "list_containers", arguments: {} });
    expect(textOf(res)).toBe('[{"id":"abc"}]');
    expect(runner.calls[0]).toEqual(["list", "--format", "json"]);
  });

  test("passes --all when requested", async () => {
    const { runner, client } = await setup([{ stdout: "[]", stderr: "" }]);
    await client.callTool({ name: "list_containers", arguments: { all: true } });
    expect(runner.calls[0]).toEqual(["list", "--format", "json", "--all"]);
  });
});

describe("container_logs", () => {
  test("returns the last 100 lines by default via CLI -n flag", async () => {
    const lines = "line 1\nline 2\nline 3";
    const { runner, client } = await setup([{ stdout: lines, stderr: "" }]);
    const res = await client.callTool({ name: "container_logs", arguments: { id: "abc" } });
    expect(textOf(res)).toBe("line 1\nline 2\nline 3");
    expect(runner.calls[0]).toEqual(["logs", "-n", "100", "abc"]);
  });

  test("respects a custom tail count via CLI -n flag", async () => {
    const lines = "a\nb\nc\nd";
    const { runner, client } = await setup([{ stdout: lines, stderr: "" }]);
    const res = await client.callTool({
      name: "container_logs",
      arguments: { id: "abc", tail: 2 },
    });
    expect(textOf(res)).toBe("a\nb\nc\nd");
    expect(runner.calls[0]).toEqual(["logs", "-n", "2", "abc"]);
  });

  test("rejects an id that looks like a flag", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "container_logs",
      arguments: { id: "--follow" },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });
});

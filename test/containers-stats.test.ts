import { describe, test, expect } from "vitest";
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

describe("container_stats", () => {
  test("returns stats JSON for a managed container", async () => {
    const { runner, client } = await setup([
      MANAGED_INSPECT,
      { stdout: '{"cpu":"5%"}', stderr: "" },
    ]);
    const res = await client.callTool({ name: "container_stats", arguments: { id: "abc" } });
    // Normalized to the flat stats contract.
    expect(JSON.parse(textOf(res))).toEqual({ cpu_percent: 5, cpu_usage_usec: 0, mem_used_mb: 0, mem_limit_mb: 0 });
    expect(runner.calls[0]).toEqual(["inspect", "abc"]);
    expect(runner.calls[1]).toEqual(["stats", "--no-stream", "--format", "json", "abc"]);
  });

  test("refuses to get stats for an unmanaged container", async () => {
    const { runner, client } = await setup([UNMANAGED_INSPECT]);
    const res: any = await client.callTool({ name: "container_stats", arguments: { id: "victim" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not managed/);
    expect(runner.calls).toEqual([["inspect", "victim"]]);
  });

  test("rejects a flag-like container id without calling the runner", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({ name: "container_stats", arguments: { id: "--all" } });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });
});

describe("inspect_container", () => {
  test("returns inspect JSON for a managed container", async () => {
    const { runner, client } = await setup([
      MANAGED_INSPECT,
      { stdout: '{"status":"running"}', stderr: "" },
    ]);
    const res = await client.callTool({ name: "inspect_container", arguments: { id: "abc" } });
    // Normalized to the flat contract schema (see src/tools/normalize.ts).
    expect(JSON.parse(textOf(res))).toEqual({
      id: "", image: "", status: "running", created_at: null, labels: {}, mounts: [],
    });
    // calls[0] is the ensureManaged inspect, calls[1] is the actual inspect_container inspect
    expect(runner.calls[0]).toEqual(["inspect", "abc"]);
    expect(runner.calls[1]).toEqual(["inspect", "abc"]);
  });

  test("refuses to inspect an unmanaged container", async () => {
    const { runner, client } = await setup([UNMANAGED_INSPECT]);
    const res: any = await client.callTool({ name: "inspect_container", arguments: { id: "victim" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not managed/);
    expect(runner.calls).toEqual([["inspect", "victim"]]);
  });

  test("rejects a flag-like container id without calling the runner", async () => {
    const { runner, client } = await setup();
    const res: any = await client.callTool({ name: "inspect_container", arguments: { id: "--all" } });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });
});

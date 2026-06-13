import { describe, test, expect } from "vitest";
import { registerSystemTools } from "../src/tools/system.js";
import { makeConfig, makeFakeRunner, makeServer, connect } from "./helpers.js";

function textOf(res: any): string {
  return res.content[0].text;
}

describe("system_status", () => {
  test("reports status from the CLI", async () => {
    const runner = makeFakeRunner([{ stdout: "apiserver is running\n", stderr: "" }]);
    const server = makeServer();
    registerSystemTools(server, { run: runner.run, config: makeConfig(), sessionId: "test-session", getClient: () => "test-client" });
    const client = await connect(server);

    const res = await client.callTool({ name: "system_status", arguments: {} });
    expect(textOf(res)).toBe("apiserver is running");
    expect(runner.calls[0]).toEqual(["system", "status"]);
  });

  test("returns the error when status fails and start is not requested", async () => {
    const runner = makeFakeRunner([new Error("service not running")]);
    const server = makeServer();
    registerSystemTools(server, { run: runner.run, config: makeConfig(), sessionId: "test-session", getClient: () => "test-client" });
    const client = await connect(server);

    const res: any = await client.callTool({ name: "system_status", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not running/);
  });

  test("starts the service when start: true and status fails", async () => {
    const runner = makeFakeRunner([new Error("down"), { stdout: "", stderr: "" }]);
    const server = makeServer();
    registerSystemTools(server, { run: runner.run, config: makeConfig(), sessionId: "test-session", getClient: () => "test-client" });
    const client = await connect(server);

    const res = await client.callTool({ name: "system_status", arguments: { start: true } });
    expect(textOf(res)).toMatch(/started/);
    expect(runner.calls[1]).toEqual(["system", "start"]);
  });

  test("read-only mode refuses to start the service", async () => {
    const runner = makeFakeRunner([new Error("down")]);
    const server = makeServer();
    registerSystemTools(server, { run: runner.run, config: makeConfig({ readOnly: true }), sessionId: "test-session", getClient: () => "test-client" });
    const client = await connect(server);

    const res: any = await client.callTool({ name: "system_status", arguments: { start: true } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Read-only/);
  });
});

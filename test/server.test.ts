import { describe, test, expect } from "vitest";
import { createServer, VERSION } from "../src/server.js";
import { makeConfig, makeFakeRunner, connect } from "./helpers.js";
import { createRequire } from "node:module";

describe("createServer", () => {
  test("VERSION tracks package.json", () => {
    const pkg = createRequire(import.meta.url)("../package.json");
    expect(VERSION).toBe(pkg.version);
  });

  test("registers all 15 tools", async () => {
    const runner = makeFakeRunner();
    const client = await connect(createServer({ run: runner.run, config: makeConfig() }));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(
      [
        "build_image",
        "container_logs",
        "container_stats",
        "copy_files",
        "exec_in_container",
        "inspect_container",
        "list_containers",
        "list_images",
        "prune_images",
        "pull_image",
        "remove_container",
        "remove_image",
        "run_container",
        "stop_container",
        "system_status",
      ].sort()
    );
  });

  test("end-to-end: list_containers flows through the injected runner", async () => {
    const runner = makeFakeRunner([{ stdout: '[{"id":"e2e"}]', stderr: "" }]);
    const client = await connect(createServer({ run: runner.run, config: makeConfig() }));
    const res: any = await client.callTool({ name: "list_containers", arguments: {} });
    expect(res.content[0].text).toBe('[{"id":"e2e"}]');
  });

  test("accepts sessionId and getClient overrides and still registers 15 tools", async () => {
    const runner = makeFakeRunner();
    const client = await connect(
      createServer({
        run: runner.run,
        config: makeConfig(),
        sessionId: "s",
        getClient: () => "c",
      })
    );
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(15);
  });
});

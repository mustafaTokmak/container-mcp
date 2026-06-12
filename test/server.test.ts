import { describe, test, expect } from "vitest";
import { createServer } from "../src/server.js";
import { makeConfig, makeFakeRunner, connect } from "./helpers.js";

describe("createServer", () => {
  test("registers all 11 tools", async () => {
    const runner = makeFakeRunner();
    const client = await connect(createServer({ run: runner.run, config: makeConfig() }));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(
      [
        "build_image",
        "container_logs",
        "copy_files",
        "exec_in_container",
        "list_containers",
        "list_images",
        "pull_image",
        "remove_container",
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
});

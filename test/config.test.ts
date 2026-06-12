import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  test("defaults: allows cwd and tmpdir, writable, agent name 'agent'", () => {
    const cfg = loadConfig({}, "/Users/me/proj");
    expect(cfg.allowedMounts).toEqual([path.resolve("/Users/me/proj"), os.tmpdir()]);
    expect(cfg.readOnly).toBe(false);
    expect(cfg.defaultCpus).toBe("2");
    expect(cfg.defaultMemory).toBe("2g");
    expect(cfg.agentName).toBe("agent");
  });

  test("CONTAINER_MCP_ALLOWED_MOUNTS replaces defaults entirely", () => {
    const cfg = loadConfig({ CONTAINER_MCP_ALLOWED_MOUNTS: "/a:/b/c" }, "/Users/me/proj");
    expect(cfg.allowedMounts).toEqual(["/a", "/b/c"]);
    expect(loadConfig({ CONTAINER_MCP_ALLOWED_MOUNTS: "rel/dir" }, "/Users/me/proj").allowedMounts)
      .toEqual(["/Users/me/proj/rel/dir"]);
  });

  test("readOnly accepts 1 and true case-insensitively", () => {
    expect(loadConfig({ CONTAINER_MCP_READONLY: "1" }, "/x").readOnly).toBe(true);
    expect(loadConfig({ CONTAINER_MCP_READONLY: "TRUE" }, "/x").readOnly).toBe(true);
    expect(loadConfig({ CONTAINER_MCP_READONLY: "no" }, "/x").readOnly).toBe(false);
    expect(loadConfig({ CONTAINER_MCP_READONLY: "" }, "/x").readOnly).toBe(false);
  });

  test("resource defaults and agent name overrides", () => {
    const cfg = loadConfig(
      {
        CONTAINER_MCP_DEFAULT_CPUS: "8",
        CONTAINER_MCP_DEFAULT_MEMORY: "8g",
        CONTAINER_MCP_AGENT_NAME: "claude",
      },
      "/x"
    );
    expect(cfg.defaultCpus).toBe("8");
    expect(cfg.defaultMemory).toBe("8g");
    expect(cfg.agentName).toBe("claude");
  });
});

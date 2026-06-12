import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  test("defaults: allows cwd and a private scratch dir (not tmpdir itself), writable, agent name 'agent'", () => {
    const cfg = loadConfig({}, "/Users/me/proj");
    expect(cfg.allowedMounts).toContain(path.resolve("/Users/me/proj"));
    // Must NOT contain the raw tmpdir — must have a private scratch subdir instead
    expect(cfg.allowedMounts).not.toContain(os.tmpdir());
    expect(cfg.allowedMounts.some((p) => p.includes("container-mcp-"))).toBe(true);
    expect(cfg.readOnly).toBe(false);
    expect(cfg.defaultCpus).toBe("2");
    expect(cfg.defaultMemory).toBe("2g");
    expect(cfg.agentName).toBe("agent");
    // Scratch dir must be accessible and owner-only
    expect((fs.statSync(cfg.scratchDir).mode & 0o077) === 0).toBe(true);
    fs.rmSync(cfg.scratchDir, { recursive: true, force: true });
  });

  test("cwd of / is not used as an implicit allowed root", () => {
    const cfg = loadConfig({}, "/");
    expect(cfg.allowedMounts).not.toContain("/");
    fs.rmSync(cfg.scratchDir, { recursive: true, force: true });
  });

  test("home directory is not used as an implicit allowed root", () => {
    const cfg = loadConfig({}, os.homedir());
    expect(cfg.allowedMounts).not.toContain(os.homedir());
    fs.rmSync(cfg.scratchDir, { recursive: true, force: true });
  });

  test("explicit env roots are honored even if broad", () => {
    const cfg = loadConfig({ CONTAINER_MCP_ALLOWED_MOUNTS: "/" }, "/Users/me/proj");
    expect(cfg.allowedMounts).toContain("/");
    fs.rmSync(cfg.scratchDir, { recursive: true, force: true });
  });

  test("CONTAINER_MCP_ALLOWED_MOUNTS replaces explicit roots but scratch dir is still appended", () => {
    const cfg = loadConfig({ CONTAINER_MCP_ALLOWED_MOUNTS: "/a:/b/c" }, "/Users/me/proj");
    expect(cfg.allowedMounts).toContain("/a");
    expect(cfg.allowedMounts).toContain("/b/c");
    expect(cfg.allowedMounts.some((p) => p.includes("container-mcp-"))).toBe(true);
    expect(loadConfig({ CONTAINER_MCP_ALLOWED_MOUNTS: "rel/dir" }, "/Users/me/proj").allowedMounts)
      .toContain("/Users/me/proj/rel/dir");
    fs.rmSync(cfg.scratchDir, { recursive: true, force: true });
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

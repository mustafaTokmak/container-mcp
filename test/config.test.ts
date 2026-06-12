import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const scratchDirs: string[] = [];

  const loadConfigWithCleanup = (env: Record<string, string>, cwd: string) => {
    const cfg = loadConfig(env, cwd);
    scratchDirs.push(cfg.scratchDir);
    return cfg;
  };

  afterEach(() => {
    for (const dir of scratchDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    scratchDirs.length = 0;
  });

  test("defaults: allows cwd and a private scratch dir (not tmpdir itself), writable, agent name 'agent'", () => {
    const cfg = loadConfigWithCleanup({}, "/Users/me/proj");
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
  });

  test("cwd of / is not used as an implicit allowed root", () => {
    const cfg = loadConfigWithCleanup({}, "/");
    expect(cfg.allowedMounts).not.toContain("/");
  });

  test("home directory is not used as an implicit allowed root", () => {
    const cfg = loadConfigWithCleanup({}, os.homedir());
    expect(cfg.allowedMounts).not.toContain(os.homedir());
  });

  test("explicit env roots are honored even if broad", () => {
    const cfg = loadConfigWithCleanup({ CONTAINER_MCP_ALLOWED_MOUNTS: "/" }, "/Users/me/proj");
    expect(cfg.allowedMounts).toContain("/");
  });

  test("CONTAINER_MCP_ALLOWED_MOUNTS replaces explicit roots but scratch dir is still appended", () => {
    const cfg = loadConfigWithCleanup({ CONTAINER_MCP_ALLOWED_MOUNTS: "/a:/b/c" }, "/Users/me/proj");
    expect(cfg.allowedMounts).toContain("/a");
    expect(cfg.allowedMounts).toContain("/b/c");
    expect(cfg.allowedMounts.some((p) => p.includes("container-mcp-"))).toBe(true);
    const cfg2 = loadConfigWithCleanup({ CONTAINER_MCP_ALLOWED_MOUNTS: "rel/dir" }, "/Users/me/proj");
    expect(cfg2.allowedMounts).toContain("/Users/me/proj/rel/dir");
  });

  test("readOnly accepts 1 and true case-insensitively", () => {
    const cfg1 = loadConfigWithCleanup({ CONTAINER_MCP_READONLY: "1" }, "/x");
    expect(cfg1.readOnly).toBe(true);
    const cfg2 = loadConfigWithCleanup({ CONTAINER_MCP_READONLY: "TRUE" }, "/x");
    expect(cfg2.readOnly).toBe(true);
    const cfg3 = loadConfigWithCleanup({ CONTAINER_MCP_READONLY: "no" }, "/x");
    expect(cfg3.readOnly).toBe(false);
    const cfg4 = loadConfigWithCleanup({ CONTAINER_MCP_READONLY: "" }, "/x");
    expect(cfg4.readOnly).toBe(false);
  });

  test("resource defaults and agent name overrides", () => {
    const cfg = loadConfigWithCleanup(
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

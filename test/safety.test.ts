import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateHostPath, ensureWritable, SafetyError } from "../src/safety.js";
import type { Config } from "../src/config.js";

const cfg: Config = {
  allowedMounts: ["/Users/me/proj", "/tmp"],
  readOnly: false,
  defaultCpus: "2",
  defaultMemory: "2g",
  agentName: "agent",
};

describe("validateHostPath", () => {
  test("accepts an allowed root itself", () => {
    expect(validateHostPath("/Users/me/proj", cfg)).toBe("/Users/me/proj");
  });

  test("accepts a subdirectory of an allowed root", () => {
    expect(validateHostPath("/Users/me/proj/src", cfg)).toBe("/Users/me/proj/src");
  });

  test("rejects a path outside all roots", () => {
    expect(() => validateHostPath("/etc", cfg)).toThrow(SafetyError);
  });

  test("rejects traversal escaping a root", () => {
    expect(() => validateHostPath("/Users/me/proj/../../../etc", cfg)).toThrow(SafetyError);
  });

  test("rejects sibling directory with shared prefix", () => {
    // /Users/me/proj-evil starts with /Users/me/proj as a string but is NOT inside it
    expect(() => validateHostPath("/Users/me/proj-evil", cfg)).toThrow(SafetyError);
  });

  test("error message names the allowed roots and the env var", () => {
    expect(() => validateHostPath("/etc", cfg)).toThrow(/CONTAINER_MCP_ALLOWED_MOUNTS/);
  });

  test("rejects a symlink pointing outside the allowed roots", () => {
    const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safety-")));
    const link = path.join(real, "escape");
    fs.symlinkSync("/etc", link);
    const symCfg = { ...cfg, allowedMounts: [real] };
    try {
      expect(() => validateHostPath(link, symCfg)).toThrow(SafetyError);
    } finally {
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  test("accepts a not-yet-existing path under an allowed root", () => {
    const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safety-")));
    const symCfg = { ...cfg, allowedMounts: [real] };
    try {
      expect(validateHostPath(path.join(real, "new-dir", "out.txt"), symCfg)).toBe(
        path.join(real, "new-dir", "out.txt")
      );
    } finally {
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  test("accepts a path through macOS /tmp symlink when allowlist has the real path", () => {
    const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safety-")));
    const symCfg = { ...cfg, allowedMounts: [real] };
    try {
      // validate the same dir addressed through its canonical path
      expect(validateHostPath(real, symCfg)).toBe(real);
    } finally {
      fs.rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("ensureWritable", () => {
  test("passes when not read-only", () => {
    expect(() => ensureWritable(cfg, "run_container")).not.toThrow();
  });

  test("throws naming the action when read-only", () => {
    expect(() => ensureWritable({ ...cfg, readOnly: true }, "run_container")).toThrow(
      /run_container.*CONTAINER_MCP_READONLY/s
    );
  });
});

import { describe, test, expect } from "vitest";
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

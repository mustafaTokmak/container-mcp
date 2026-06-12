import { describe, test, expect, afterEach } from "vitest";
import { createCliRunner, CliError } from "../src/cli.js";

function fakeExec(result: { stdout: string; stderr: string } | Error) {
  const calls: { cmd: string; args: string[] }[] = [];
  const optsSeen: unknown[] = [];
  const fn = async (cmd: string, args: string[], opts?: unknown) => {
    calls.push({ cmd, args });
    optsSeen.push(opts);
    if (result instanceof Error) throw result;
    return result;
  };
  return { fn, calls, optsSeen };
}

describe("createCliRunner", () => {
  test("invokes the container binary with given args and returns output", async () => {
    const { fn, calls, optsSeen } = fakeExec({ stdout: "[]", stderr: "" });
    const run = createCliRunner(fn);
    const res = await run(["list", "--format", "json"]);
    expect(res.stdout).toBe("[]");
    expect(calls[0]).toEqual({ cmd: "container", args: ["list", "--format", "json"] });
    expect(optsSeen[0]).toMatchObject({ timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  });

  test("maps ENOENT to an install hint", async () => {
    const err = Object.assign(new Error("spawn container ENOENT"), { code: "ENOENT" });
    const run = createCliRunner(fakeExec(err).fn);
    await expect(run(["list"])).rejects.toThrow(/not installed.*github\.com\/apple\/container/s);
  });

  test("maps non-zero exit to CliError carrying stderr", async () => {
    const err = Object.assign(new Error("exit 1"), { code: 1, stderr: "no such container abc" });
    const run = createCliRunner(fakeExec(err).fn);
    await expect(run(["stop", "abc"])).rejects.toThrow(/no such container abc/);
  });

  test("adds service hint when stderr suggests the service is down", async () => {
    const err = Object.assign(new Error("exit 1"), { code: 1, stderr: "XPC connection error" });
    const run = createCliRunner(fakeExec(err).fn);
    await expect(run(["list"])).rejects.toThrow(/system_status/);
  });

  test("CliError is an Error with name CliError", async () => {
    const err = Object.assign(new Error("exit 1"), { code: 1, stderr: "boom" });
    const run = createCliRunner(fakeExec(err).fn);
    const caught = await run(["list"]).catch((e) => e);
    expect(caught).toBeInstanceOf(CliError);
  });

  test("timeout produces a readable error, not a blank one", async () => {
    const err = Object.assign(new Error("Command failed"), {
      code: null, killed: true, signal: "SIGTERM", stderr: "",
    });
    const run = createCliRunner(fakeExec(err).fn);
    await expect(run(["run", "ubuntu"])).rejects.toThrow(/timed out after \d+ms/);
  });

  test("maxBuffer overflow produces a readable error", async () => {
    const err = Object.assign(new Error("stdout maxBuffer length exceeded"), {
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stderr: "",
    });
    const run = createCliRunner(fakeExec(err).fn);
    await expect(run(["logs", "abc"])).rejects.toThrow(/more than 10MB/);
  });

  // --- New tests for Fix Round Task 2 ---

  test("per-call timeout overrides the default", async () => {
    const { fn, optsSeen } = fakeExec({ stdout: "", stderr: "" });
    const run = createCliRunner(fn);
    await run(["images", "pull", "x"], { timeoutMs: 600_000 });
    expect((optsSeen[0] as { timeout: number }).timeout).toBe(600_000);
  });

  describe("CONTAINER_MCP_TIMEOUT_MS sets the base timeout", () => {
    const originalEnv = process.env.CONTAINER_MCP_TIMEOUT_MS;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CONTAINER_MCP_TIMEOUT_MS;
      } else {
        process.env.CONTAINER_MCP_TIMEOUT_MS = originalEnv;
      }
    });

    test("reads env at creation time", async () => {
      process.env.CONTAINER_MCP_TIMEOUT_MS = "5000";
      const { fn, optsSeen } = fakeExec({ stdout: "", stderr: "" });
      const run = createCliRunner(fn);
      await run(["list"]);
      expect((optsSeen[0] as { timeout: number }).timeout).toBe(5000);
    });
  });

  test("non-zero exit includes exit code and stdout tail", async () => {
    const err = Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: "47 tests passed, 1 failed\n",
      stderr: "exit status 1",
    });
    const { fn } = fakeExec(err);
    const run = createCliRunner(fn);
    const caught = await run(["exec", "c1", "npm", "test"]).catch((e) => e);
    expect(caught).toBeInstanceOf(CliError);
    expect(caught.message).toMatch(/exit 1/);
    expect(caught.message).toMatch(/1 failed/);
    expect(caught.exitCode).toBe(1);
  });

  test("timeout error names the env var", async () => {
    const err = Object.assign(new Error("Command failed"), {
      code: null, killed: true, signal: "SIGTERM", stderr: "",
    });
    const run = createCliRunner(fakeExec(err).fn);
    const caught = await run(["images", "pull", "ubuntu"]).catch((e) => e);
    expect(caught.message).toMatch(/CONTAINER_MCP_TIMEOUT_MS/);
  });
});

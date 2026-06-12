import { describe, test, expect } from "vitest";
import { createCliRunner, CliError } from "../src/cli.js";

function fakeExec(result: { stdout: string; stderr: string } | Error) {
  const calls: { cmd: string; args: string[] }[] = [];
  const fn = async (cmd: string, args: string[], _opts?: unknown) => {
    calls.push({ cmd, args });
    if (result instanceof Error) throw result;
    return result;
  };
  return { fn, calls };
}

describe("createCliRunner", () => {
  test("invokes the container binary with given args and returns output", async () => {
    const { fn, calls } = fakeExec({ stdout: "[]", stderr: "" });
    const run = createCliRunner(fn);
    const res = await run(["list", "--format", "json"]);
    expect(res.stdout).toBe("[]");
    expect(calls[0]).toEqual({ cmd: "container", args: ["list", "--format", "json"] });
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
});

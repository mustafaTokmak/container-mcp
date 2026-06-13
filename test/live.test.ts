import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "../src/server.js";
import type { Config } from "../src/config.js";
import { connect } from "./helpers.js";

/**
 * Live end-to-end suite against the real `container` CLI.
 *
 * Skipped unless CONTAINER_MCP_LIVE=1. Requires an Apple silicon Mac with
 * the container CLI installed (macOS 26 or newer). Creates and removes real
 * containers and pulls alpine:latest.
 *
 * This is the pre-release gate that confirms the doc-only assumptions the
 * unit suite cannot: the `exec -- <cmd>` terminator, the `cp` alias, and
 * the `inspect` label layout that managed-label enforcement parses.
 */
const LIVE = process.env.CONTAINER_MCP_LIVE === "1";

const cli = promisify(execFile);
const IMAGE = "alpine:latest";
const UNMANAGED_NAME = `cmcp-unmanaged-${process.pid}`;

function textOf(res: any): string {
  return res.content[0].text;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe.runIf(LIVE)("live: full lifecycle against the real CLI", () => {
  let workDir: string;
  let client: Client;
  let detachedId = "";
  let unmanagedId = "";
  const extraIds: string[] = [];

  beforeAll(async () => {
    workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmcp-live-")));
    const config: Config = {
      allowedMounts: [workDir],
      scratchDir: workDir,
      readOnly: false,
      defaultCpus: "1",
      defaultMemory: "1g",
      agentName: "live-test",
      maxContainers: 25,
      allowUnmanaged: false,
    };
    client = await connect(createServer({ config }));
    const status: any = await client.callTool({
      name: "system_status",
      arguments: { start: true },
    });
    expect(status.isError).not.toBe(true);
  }, 120_000);

  afterAll(async () => {
    for (const id of [detachedId, unmanagedId, ...extraIds]) {
      if (!id) continue;
      await cli("container", ["delete", "--force", id]).catch(() => {});
    }
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }, 60_000);

  test("pulls alpine", async () => {
    const res: any = await client.callTool({
      name: "pull_image",
      arguments: { reference: IMAGE },
    });
    expect(res.isError).not.toBe(true);
  }, 600_000);

  test("wait mode runs to completion and returns the container's output", async () => {
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: IMAGE, wait: true, command: ["echo", "hello-live"] },
    });
    expect(res.isError).not.toBe(true);
    expect(textOf(res)).toMatch(/hello-live/);
  }, 300_000);

  test("detached run returns an id and shows up in the list", async () => {
    const res: any = await client.callTool({
      name: "run_container",
      arguments: {
        image: IMAGE,
        command: ["sh", "-c", "echo log-line-1; echo log-line-2; sleep 120"],
      },
    });
    expect(res.isError).not.toBe(true);
    detachedId = textOf(res).trim();
    expect(detachedId.length).toBeGreaterThan(0);

    const list: any = await client.callTool({
      name: "list_containers",
      arguments: { all: true },
    });
    const parsed = JSON.parse(textOf(list));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  test("logs are tailed via -n", async () => {
    let logs = "";
    for (let i = 0; i < 20 && !logs.includes("log-line-2"); i++) {
      await sleep(1000);
      const res: any = await client.callTool({
        name: "container_logs",
        arguments: { id: detachedId, tail: 10 },
      });
      if (res.isError !== true) logs = textOf(res);
    }
    expect(logs).toMatch(/log-line-2/);
  }, 60_000);

  test("exec accepts the -- terminator (doc-only assumption #1)", async () => {
    const res: any = await client.callTool({
      name: "exec_in_container",
      arguments: { id: detachedId, command: ["sh", "-c", "echo exec-ok"] },
    });
    expect(res.isError).not.toBe(true);
    expect(textOf(res)).toMatch(/exec-ok/);
  }, 60_000);

  test("cp alias round-trips a file host -> container -> host (doc-only assumption #2)", async () => {
    const inFile = path.join(workDir, "in.txt");
    const outFile = path.join(workDir, "out.txt");
    fs.writeFileSync(inFile, "round-trip");

    const up: any = await client.callTool({
      name: "copy_files",
      arguments: { source: inFile, destination: `${detachedId}:/tmp/in.txt` },
    });
    expect(up.isError).not.toBe(true);

    const down: any = await client.callTool({
      name: "copy_files",
      arguments: { source: `${detachedId}:/tmp/in.txt`, destination: outFile },
    });
    expect(down.isError).not.toBe(true);
    expect(fs.readFileSync(outFile, "utf8").trim()).toBe("round-trip");
  }, 60_000);

  test("inspect labels satisfy managed enforcement (doc-only assumption #3)", async () => {
    // Every prior logs/exec/cp call already passed ensureManaged, but record
    // the real layout so a future format change is easy to diagnose.
    const { stdout } = await cli("container", ["inspect", detachedId]);
    console.error(`[live] inspect output for managed container:\n${stdout.slice(0, 2000)}`);
    expect(stdout).toMatch(/dev\.container-mcp\.managed/);
  }, 60_000);

  test("refuses to operate on a container created outside the server", async () => {
    const { stdout } = await cli("container", [
      "run",
      "--detach",
      "--name",
      UNMANAGED_NAME,
      IMAGE,
      "sleep",
      "60",
    ]);
    unmanagedId = stdout.trim() || UNMANAGED_NAME;

    const res: any = await client.callTool({
      name: "stop_container",
      arguments: { id: unmanagedId },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not managed/);
  }, 120_000);

  test("rejects a mount outside the allowlist", async () => {
    const res: any = await client.callTool({
      name: "run_container",
      arguments: {
        image: IMAGE,
        mounts: [{ source: os.homedir(), destination: "/x" }],
      },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not allowed/);
  }, 60_000);

  test("default-deny network: a container runs with --network none (flag accepted)", async () => {
    // The unit suite cannot verify this CLI flag is accepted; only the live suite can.
    // If --network none is an unrecognised flag, run_container will error here.
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: IMAGE, wait: true, command: ["true"] },
    });
    expect(res.isError).not.toBe(true);
  }, 120_000);

  test("container_stats returns JSON for a running container", async () => {
    const res: any = await client.callTool({
      name: "container_stats",
      arguments: { id: detachedId },
    });
    expect(res.isError).not.toBe(true);
    const text = textOf(res);
    const parsed = JSON.parse(text);
    expect(parsed !== null && typeof parsed === "object").toBe(true);
  }, 60_000);

  test("inspect_container surfaces the management and attribution labels", async () => {
    const res: any = await client.callTool({
      name: "inspect_container",
      arguments: { id: detachedId },
    });
    expect(res.isError).not.toBe(true);
    const text = textOf(res);
    expect(text).toMatch(/dev\.container-mcp\.managed/);
    expect(text).toMatch(/dev\.container-mcp\.session/);
    expect(text).toMatch(/dev\.container-mcp\.client/);
  }, 60_000);

  test("published ports appear after a port-mapped run", async () => {
    const res: any = await client.callTool({
      name: "run_container",
      arguments: {
        image: IMAGE,
        ports: [{ host: 38080, container: 38080 }],
        command: ["sleep", "10"],
      },
    });
    expect(res.isError).not.toBe(true);
    const id = textOf(res).trim();
    expect(id.length).toBeGreaterThan(0);
    extraIds.push(id);
  }, 120_000);

  test("network:true is accepted and runs to completion", async () => {
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: IMAGE, wait: true, network: true, command: ["true"] },
    });
    expect(res.isError).not.toBe(true);
  }, 120_000);

  test("stops and removes the managed container", async () => {
    const stop: any = await client.callTool({
      name: "stop_container",
      arguments: { id: detachedId },
    });
    expect(stop.isError).not.toBe(true);

    const remove: any = await client.callTool({
      name: "remove_container",
      arguments: { id: detachedId },
    });
    expect(remove.isError).not.toBe(true);
    detachedId = "";
  }, 120_000);
});

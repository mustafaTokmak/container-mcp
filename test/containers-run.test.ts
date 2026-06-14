import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerContainerTools } from "../src/tools/containers.js";
import { makeConfig, makeFakeRunner, makeServer, connect } from "./helpers.js";
import { CliError } from "../src/cli.js";

function textOf(res: any): string {
  return res.content[0].text;
}

async function setup(results: any[] = [], cfgOverrides = {}) {
  const runner = makeFakeRunner(results);
  const server = makeServer();
  registerContainerTools(server, {
    run: runner.run,
    config: makeConfig(cfgOverrides),
    sessionId: "test-session",
    getClient: () => "test-client",
  });
  const client = await connect(server);
  return { runner, client };
}

describe("run_container", () => {
  test("runs detached with default limits and management labels", async () => {
    const { runner, client } = await setup([
      { stdout: "[]", stderr: "" },
      { stdout: "abc123\n", stderr: "" },
    ]);
    const res = await client.callTool({
      name: "run_container",
      arguments: { image: "alpine:latest" },
    });
    expect(textOf(res)).toBe("abc123");
    expect(runner.calls[1]).toEqual([
      "run",
      "--detach",
      "--cpus",
      "2",
      "--memory",
      "2g",
      "--network",
      "none",
      "--label",
      "dev.container-mcp.managed=true",
      "--label",
      "dev.container-mcp.agent=claude",
      "--label",
      "dev.container-mcp.session=test-session",
      "--label",
      "dev.container-mcp.client=test-client",
      "--label",
      "dev.container-mcp.network=denied",
      "alpine:latest",
    ]);
  });

  test("applies name, command, env, and per-call limits", async () => {
    const { runner, client } = await setup([
      { stdout: "[]", stderr: "" },
      { stdout: "id1", stderr: "" },
    ]);
    await client.callTool({
      name: "run_container",
      arguments: {
        image: "node:20",
        name: "test-run",
        command: ["node", "-e", "console.log(1)"],
        cpus: "4",
        memory: "4g",
        env: { FOO: "bar" },
      },
    });
    const args = runner.calls[1];
    expect(args).toContain("--name");
    expect(args[args.indexOf("--name") + 1]).toBe("test-run");
    expect(args[args.indexOf("--cpus") + 1]).toBe("4");
    expect(args[args.indexOf("--memory") + 1]).toBe("4g");
    expect(args).toContain("--env");
    expect(args[args.indexOf("--env") + 1]).toBe("FOO=bar");
    expect(args.slice(-4)).toEqual(["node:20", "node", "-e", "console.log(1)"]);
  });

  test("mounts an allowed path, optionally read-only", async () => {
    // Create real temp dirs so validateExistingHostPath can resolve them.
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmcp-run-")));
    const src = path.join(root, "src");
    const cache = path.join(root, "cache");
    fs.mkdirSync(src);
    fs.mkdirSync(cache);
    try {
      const { runner, client } = await setup(
        [
          { stdout: "[]", stderr: "" },
          { stdout: "id2", stderr: "" },
        ],
        { allowedMounts: [root] }
      );
      await client.callTool({
        name: "run_container",
        arguments: {
          image: "alpine",
          mounts: [
            { source: src, destination: "/work" },
            { source: cache, destination: "/cache", readonly: true },
          ],
        },
      });
      const args = runner.calls[1];
      const volumes = args.filter((_, i) => args[i - 1] === "--volume");
      expect(volumes).toEqual([`${src}:/work`, `${cache}:/cache:ro`]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a mount outside the allowlist without calling the CLI", async () => {
    const { runner, client } = await setup([{ stdout: "[]", stderr: "" }]);
    const res: any = await client.callTool({
      name: "run_container",
      arguments: {
        image: "alpine",
        mounts: [{ source: "/etc", destination: "/host-etc" }],
      },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not allowed/);
    expect(runner.calls.length).toBe(1);
  });

  test("rejects an image that looks like a flag", async () => {
    const { runner, client } = await setup([{ stdout: "[]", stderr: "" }]);
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "--privileged" },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(1);
  });

  test("blocked entirely in read-only mode", async () => {
    const { runner, client } = await setup([], { readOnly: true });
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "alpine" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Read-only/);
    expect(runner.calls.length).toBe(0);
  });

  test("rejects cpus/memory values that look like flags", async () => {
    const { runner, client } = await setup([{ stdout: "[]", stderr: "" }]);
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "alpine", cpus: "--network=host" },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(1);
  });

  test("rejects a mount destination containing a colon", async () => {
    // Source must exist so validateExistingHostPath passes; the destination check fires next.
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmcp-dest-")));
    const src = path.join(root, "src");
    fs.mkdirSync(src);
    try {
      const { runner, client } = await setup(
        [{ stdout: "[]", stderr: "" }],
        { allowedMounts: [root] }
      );
      const res: any = await client.callTool({
        name: "run_container",
        arguments: {
          image: "alpine",
          mounts: [{ source: src, destination: "/x:/y" }],
        },
      });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/Invalid mount destination/);
      expect(runner.calls.length).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects an env variable name containing '='", async () => {
    // Zod schema rejects invalid env keys before the handler runs, so no CLI calls.
    const { runner, client } = await setup();
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "alpine", env: { "FOO=BAR": "x" } },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(0);
  });

  test("refuses to run when the container limit is reached", async () => {
    const { runner, client } = await setup(
      [{ stdout: '[{"id":"a"},{"id":"b"}]', stderr: "" }],
      { maxContainers: 2 }
    );
    const res: any = await client.callTool({ name: "run_container", arguments: { image: "alpine" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/CONTAINER_MCP_MAX_CONTAINERS/);
    expect(runner.calls.length).toBe(1);
  });

  test("proceeds when list output is not parseable JSON", async () => {
    const { runner, client } = await setup([
      { stdout: "not json", stderr: "" },
      { stdout: "abc123\n", stderr: "" },
    ]);
    const res = await client.callTool({ name: "run_container", arguments: { image: "alpine" } });
    expect(textOf(res)).toBe("abc123");
  });

  test("wait: true runs attached with a long timeout and returns output", async () => {
    const { runner, client } = await setup([
      { stdout: "[]", stderr: "" },
      { stdout: "47 tests passed\n", stderr: "" },
    ]);
    const res = await client.callTool({
      name: "run_container",
      arguments: { image: "node:20", wait: true, command: ["npm", "test"] },
    });
    expect(textOf(res)).toBe("47 tests passed");
    expect(runner.calls[1]).not.toContain("--detach");
    expect(runner.calls[1].slice(-3)).toEqual(["node:20", "npm", "test"]);
    expect(runner.optsLog[1]).toEqual({ timeoutMs: 600_000 });
  });

  test("workdir is passed through guarded", async () => {
    const { runner, client } = await setup([
      { stdout: "[]", stderr: "" },
      { stdout: "id", stderr: "" },
    ]);
    await client.callTool({
      name: "run_container",
      arguments: { image: "alpine", workdir: "/work" },
    });
    const args = runner.calls[1];
    expect(args[args.indexOf("--workdir") + 1]).toBe("/work");
  });

  test("rejects a command whose first token looks like a flag", async () => {
    const { runner, client } = await setup([{ stdout: "[]", stderr: "" }]);
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "alpine", command: ["--rm", "x"] },
    });
    expect(res.isError).toBe(true);
    expect(runner.calls.length).toBe(1);
  });

  test("wait mode returns structured exitCode/stdout/stderr on success", async () => {
    const { client } = await setup([
      { stdout: "[]", stderr: "" },
      { stdout: "47 passing\n", stderr: "warn\n" },
    ]);
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "node:20", wait: true, command: ["npm", "test"] },
    });
    expect(textOf(res)).toBe("47 passing");
    expect(res.structuredContent).toEqual({ exitCode: 0, stdout: "47 passing\n", stderr: "warn\n" });
  });

  test("wait mode surfaces non-zero exit as structured failure", async () => {
    const e = new CliError("container run ... failed (exit 1): boom");
    e.exitCode = 1;
    e.stdout = "1 failing\n";
    e.stderr = "boom\n";
    const { client } = await setup([{ stdout: "[]", stderr: "" }, e]);
    const res: any = await client.callTool({
      name: "run_container",
      arguments: { image: "node:20", wait: true, command: ["npm", "test"] },
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ exitCode: 1, stdout: "1 failing\n", stderr: "boom\n" });
  });

  describe("network", () => {
    test("denies network by default (adds --network none)", async () => {
      const { runner, client } = await setup([
        { stdout: "[]", stderr: "" },
        { stdout: "abc123\n", stderr: "" },
      ]);
      await client.callTool({
        name: "run_container",
        arguments: { image: "alpine" },
      });
      const args = runner.calls[1];
      const netIdx = args.indexOf("--network");
      expect(netIdx).toBeGreaterThan(-1);
      expect(args[netIdx + 1]).toBe("none");
    });

    test("allows network when per-call network:true", async () => {
      const { runner, client } = await setup([
        { stdout: "[]", stderr: "" },
        { stdout: "abc123\n", stderr: "" },
      ]);
      await client.callTool({
        name: "run_container",
        arguments: { image: "alpine", network: true },
      });
      const args = runner.calls[1];
      const netIdx = args.indexOf("--network");
      // --network none must not appear; no --network flag at all is the allowed state
      expect(netIdx === -1 || args[netIdx + 1] !== "none").toBe(true);
      // and the network posture label reflects the decision for the GUI boundary bar
      expect(args).toContain("dev.container-mcp.network=allowed");
    });

    test("stamps network=denied label by default for the GUI boundary", async () => {
      const { runner, client } = await setup([
        { stdout: "[]", stderr: "" },
        { stdout: "abc123\n", stderr: "" },
      ]);
      await client.callTool({ name: "run_container", arguments: { image: "alpine" } });
      expect(runner.calls[1]).toContain("dev.container-mcp.network=denied");
    });

    test("allows network when CONTAINER_MCP_ALLOW_NETWORK config is set", async () => {
      const { runner, client } = await setup(
        [
          { stdout: "[]", stderr: "" },
          { stdout: "abc123\n", stderr: "" },
        ],
        { allowNetwork: true }
      );
      await client.callTool({
        name: "run_container",
        arguments: { image: "alpine" },
      });
      const args = runner.calls[1];
      const netIdx = args.indexOf("--network");
      expect(netIdx === -1 || args[netIdx + 1] !== "none").toBe(true);
    });

    test("per-call network:false overrides allowNetwork config", async () => {
      const { runner, client } = await setup(
        [
          { stdout: "[]", stderr: "" },
          { stdout: "abc123\n", stderr: "" },
        ],
        { allowNetwork: true }
      );
      await client.callTool({
        name: "run_container",
        arguments: { image: "alpine", network: false },
      });
      const args = runner.calls[1];
      const netIdx = args.indexOf("--network");
      expect(netIdx).toBeGreaterThan(-1);
      expect(args[netIdx + 1]).toBe("none");
    });
  });

  describe("ports", () => {
    test("publishes a port", async () => {
      const { runner, client } = await setup([
        { stdout: "[]", stderr: "" },
        { stdout: "abc123\n", stderr: "" },
      ]);
      await client.callTool({
        name: "run_container",
        arguments: { image: "alpine", ports: [{ host: 3000, container: 3000 }] },
      });
      const args = runner.calls[1];
      const idx = args.indexOf("--publish");
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe("3000:3000");
    });

    test("supports protocol and multiple ports", async () => {
      const { runner, client } = await setup([
        { stdout: "[]", stderr: "" },
        { stdout: "abc123\n", stderr: "" },
      ]);
      await client.callTool({
        name: "run_container",
        arguments: {
          image: "alpine",
          ports: [
            { host: 8080, container: 80, protocol: "udp" },
            { host: 443, container: 443 },
          ],
        },
      });
      const args = runner.calls[1];
      const idx1 = args.indexOf("--publish");
      expect(idx1).toBeGreaterThan(-1);
      expect(args[idx1 + 1]).toBe("8080:80/udp");
      const idx2 = args.indexOf("--publish", idx1 + 1);
      expect(idx2).toBeGreaterThan(-1);
      expect(args[idx2 + 1]).toBe("443:443");
    });

    test("rejects an out-of-range port at the schema layer", async () => {
      const { runner, client } = await setup();
      const res: any = await client
        .callTool({
          name: "run_container",
          arguments: { image: "alpine", ports: [{ host: 70000, container: 80 }] },
        })
        .catch(() => ({ isError: true }));
      expect(res.isError).toBe(true);
      expect(runner.calls.length).toBe(0);
    });
  });

  describe("attribution", () => {
    test("stamps session and client labels", async () => {
      const { runner, client } = await setup([
        { stdout: "[]", stderr: "" },
        { stdout: "abc123\n", stderr: "" },
      ]);
      await client.callTool({ name: "run_container", arguments: { image: "alpine" } });
      const args = runner.calls[1];
      const sessionIdx = args.indexOf("dev.container-mcp.session=test-session");
      expect(sessionIdx).toBeGreaterThan(-1);
      expect(args[sessionIdx - 1]).toBe("--label");
      const clientIdx = args.indexOf("dev.container-mcp.client=test-client");
      expect(clientIdx).toBeGreaterThan(-1);
      expect(args[clientIdx - 1]).toBe("--label");
      // session label appears before client label
      expect(sessionIdx).toBeLessThan(clientIdx);
    });

    test("sanitizes a client name with unsafe characters", async () => {
      const runner = makeFakeRunner([
        { stdout: "[]", stderr: "" },
        { stdout: "abc123\n", stderr: "" },
      ]);
      const server = makeServer();
      registerContainerTools(server, {
        run: runner.run,
        config: makeConfig(),
        sessionId: "test-session",
        getClient: () => "Claude Code/1.0 (x=y)",
      });
      const client = await connect(server);
      await client.callTool({ name: "run_container", arguments: { image: "alpine" } });
      const args = runner.calls[1];
      const clientLabelIdx = args.findIndex((a) => a.startsWith("dev.container-mcp.client="));
      expect(clientLabelIdx).toBeGreaterThan(-1);
      const labelValue = args[clientLabelIdx].slice("dev.container-mcp.client=".length);
      // Must only contain [A-Za-z0-9._-]
      expect(/^[A-Za-z0-9._-]+$/.test(labelValue)).toBe(true);
      // No spaces, slashes, or equals signs
      expect(labelValue).not.toContain(" ");
      expect(labelValue).not.toContain("/");
      expect(labelValue).not.toContain("=");
    });
  });
});

import type { CliResult, CliRunner, RunOptions } from "../src/cli.js";
import type { Config } from "../src/config.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    allowedMounts: ["/Users/me/proj", "/tmp"],
    scratchDir: "/tmp",
    readOnly: false,
    defaultCpus: "2",
    defaultMemory: "2g",
    agentName: "claude",
    maxContainers: 10,
    ...overrides,
  };
}

export interface FakeRunner {
  run: CliRunner;
  calls: string[][];
  optsLog: (RunOptions | undefined)[];
}

/** Records every call; returns queued results in order, then a default empty result. */
export function makeFakeRunner(results: (CliResult | Error)[] = []): FakeRunner {
  const calls: string[][] = [];
  const optsLog: (RunOptions | undefined)[] = [];
  const queue = [...results];
  return {
    calls,
    optsLog,
    run: async (args: string[], opts?: RunOptions) => {
      calls.push(args);
      optsLog.push(opts);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next ?? { stdout: "", stderr: "" };
    },
  };
}

export async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

export function makeServer(): McpServer {
  return new McpServer({ name: "test-server", version: "0.0.0" });
}

import type { CliResult } from "../src/cli.js";
import type { Config } from "../src/config.js";

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    allowedMounts: ["/Users/me/proj", "/tmp"],
    readOnly: false,
    defaultCpus: "2",
    defaultMemory: "2g",
    agentName: "claude",
    ...overrides,
  };
}

export interface FakeRunner {
  run: (args: string[]) => Promise<CliResult>;
  calls: string[][];
}

/** Records every call; returns queued results in order, then a default empty result. */
export function makeFakeRunner(results: (CliResult | Error)[] = []): FakeRunner {
  const calls: string[][] = [];
  const queue = [...results];
  return {
    calls,
    run: async (args: string[]) => {
      calls.push(args);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next ?? { stdout: "", stderr: "" };
    },
  };
}

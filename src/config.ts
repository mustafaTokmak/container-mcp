import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Config {
  allowedMounts: string[];
  scratchDir: string;
  readOnly: boolean;
  defaultCpus: string;
  defaultMemory: string;
  agentName: string;
  maxContainers: number;
}

export const MANAGED_LABEL = "dev.container-mcp.managed=true";
export const AGENT_LABEL_KEY = "dev.container-mcp.agent";

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): Config {
  // Create a per-process private scratch dir (mode 0700) for every invocation.
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-mcp-"));

  let allowedMounts: string[];

  if (env.CONTAINER_MCP_ALLOWED_MOUNTS) {
    // Operator-supplied roots are trusted and honored verbatim (even "/" or home).
    const explicit = env.CONTAINER_MCP_ALLOWED_MOUNTS
      .split(":")
      .filter(Boolean)
      .map((p) => path.resolve(cwd, p));
    // Always append the private scratch dir so agents have a writable area.
    allowedMounts = [...explicit, scratchDir];
  } else {
    const resolvedCwd = path.resolve(cwd);
    const home = os.homedir();
    // Exclude "/" and $HOME as implicit roots — Claude Desktop launches with cwd="/"
    // which would otherwise make the entire filesystem mountable.
    const cwdEntry =
      resolvedCwd === "/" || resolvedCwd === home ? [] : [resolvedCwd];
    allowedMounts = [...cwdEntry, scratchDir];
  }

  const rawMax = env.CONTAINER_MCP_MAX_CONTAINERS;
  const parsedMax = rawMax !== undefined ? parseInt(rawMax, 10) : NaN;
  const maxContainers = Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : 10;

  return {
    allowedMounts,
    scratchDir,
    readOnly: /^(1|true)$/i.test(env.CONTAINER_MCP_READONLY ?? ""),
    defaultCpus: env.CONTAINER_MCP_DEFAULT_CPUS ?? "2",
    defaultMemory: env.CONTAINER_MCP_DEFAULT_MEMORY ?? "2g",
    agentName: env.CONTAINER_MCP_AGENT_NAME ?? "agent",
    maxContainers,
  };
}

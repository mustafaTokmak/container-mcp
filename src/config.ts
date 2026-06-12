import os from "node:os";
import path from "node:path";

export interface Config {
  allowedMounts: string[];
  readOnly: boolean;
  defaultCpus: string;
  defaultMemory: string;
  agentName: string;
}

export const MANAGED_LABEL = "dev.container-mcp.managed=true";
export const AGENT_LABEL_KEY = "dev.container-mcp.agent";

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): Config {
  const allowedMounts = env.CONTAINER_MCP_ALLOWED_MOUNTS
    ? env.CONTAINER_MCP_ALLOWED_MOUNTS.split(":").filter(Boolean).map((p) => path.resolve(cwd, p))
    : [path.resolve(cwd), os.tmpdir()];

  return {
    allowedMounts,
    readOnly: /^(1|true)$/i.test(env.CONTAINER_MCP_READONLY ?? ""),
    defaultCpus: env.CONTAINER_MCP_DEFAULT_CPUS ?? "2",
    defaultMemory: env.CONTAINER_MCP_DEFAULT_MEMORY ?? "2g",
    agentName: env.CONTAINER_MCP_AGENT_NAME ?? "agent",
  };
}

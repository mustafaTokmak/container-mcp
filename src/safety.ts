import path from "node:path";
import type { Config } from "./config.js";

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyError";
  }
}

export function validateHostPath(p: string, config: Config): string {
  const resolved = path.resolve(p);
  const allowed = config.allowedMounts.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
  if (!allowed) {
    throw new SafetyError(
      `Host path not allowed: ${resolved}. Allowed roots: ${config.allowedMounts.join(", ")}. ` +
        `Set CONTAINER_MCP_ALLOWED_MOUNTS (colon-separated) to change the allowlist.`
    );
  }
  return resolved;
}

export function ensureWritable(config: Config, action: string): void {
  if (config.readOnly) {
    throw new SafetyError(
      `Read-only mode: ${action} is disabled because CONTAINER_MCP_READONLY is set.`
    );
  }
}

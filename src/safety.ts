import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyError";
  }
}

/**
 * Resolve symlinks for the existing portion of a path; non-existent
 * tails are rejoined verbatim so not-yet-created targets still validate.
 */
function canonicalize(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(canonicalize(parent), path.basename(p));
  }
}

export function validateHostPath(p: string, config: Config): string {
  const resolved = canonicalize(path.resolve(p));
  const allowed = config.allowedMounts.some((entry) => {
    const root = canonicalize(entry);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
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

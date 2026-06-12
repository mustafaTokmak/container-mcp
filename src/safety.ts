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

/**
 * User-supplied values that become CLI arguments must not be mistakable
 * for flags. execFile prevents shell injection, but a value like "--help"
 * would still be parsed as an option by the container CLI.
 */
export function assertSafeCliValue(value: string, label: string): string {
  if (value.startsWith("-")) {
    throw new SafetyError(`Invalid ${label}: ${JSON.stringify(value)} (must not start with "-")`);
  }
  return value;
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

/**
 * Like validateHostPath, but the path must already exist: the full
 * realpath (no non-existent-tail fallback) is what gets checked and
 * returned. Use for anything the container CLI will dereference later
 * (mount sources, build contexts, dockerfiles) so a symlink cannot be
 * swapped in after validation.
 */
export function validateExistingHostPath(p: string, config: Config): string {
  const resolved = path.resolve(p);
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    throw new SafetyError(
      `Host path does not exist: ${resolved}. ` +
        `Mount sources, build contexts, and dockerfiles must exist before use.`
    );
  }
  return validateHostPath(real, config);
}

export function ensureWritable(config: Config, action: string): void {
  if (config.readOnly) {
    throw new SafetyError(
      `Read-only mode: ${action} is disabled because CONTAINER_MCP_READONLY is set.`
    );
  }
}

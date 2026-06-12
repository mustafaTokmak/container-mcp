import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface CliResult {
  stdout: string;
  stderr: string;
}

export type CliRunner = (args: string[]) => Promise<CliResult>;

export class CliError extends Error {
  constructor(message: string, hint?: string) {
    super(hint ? `${message}\n${hint}` : message);
    this.name = "CliError";
  }
}

const NOT_INSTALLED_HINT =
  "The 'container' CLI is not installed. Download the signed installer from " +
  "https://github.com/apple/container/releases (Apple silicon Mac required, macOS 26 recommended).";

const SERVICE_HINT =
  "The container system service may not be running. Call the system_status tool with start: true to start it.";

type ExecFn = (
  cmd: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec = promisify(execFile) as unknown as ExecFn;

export function createCliRunner(execFn: ExecFn = defaultExec): CliRunner {
  return async (args: string[]): Promise<CliResult> => {
    try {
      const { stdout, stderr } = await execFn("container", args, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string };
      if (e.code === "ENOENT") {
        throw new CliError("container CLI not found", NOT_INSTALLED_HINT);
      }
      const stderr = (e.stderr ?? e.message ?? "").trim();
      const hint = /not running|connection|XPC|daemon/i.test(stderr) ? SERVICE_HINT : undefined;
      throw new CliError(`container ${args.join(" ")} failed: ${stderr}`, hint);
    }
  };
}

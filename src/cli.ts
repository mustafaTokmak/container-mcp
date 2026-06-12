import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface CliResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutMs?: number;
}

export type CliRunner = (args: string[], opts?: RunOptions) => Promise<CliResult>;

export class CliError extends Error {
  exitCode?: number;

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

const execFileAsync = promisify(execFile);
const defaultExec: ExecFn = (cmd, args, opts) =>
  execFileAsync(cmd, args, opts) as Promise<{ stdout: string; stderr: string }>;

function parsePositiveInt(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function createCliRunner(execFn: ExecFn = defaultExec): CliRunner {
  const baseTimeout = parsePositiveInt(process.env.CONTAINER_MCP_TIMEOUT_MS) ?? 120_000;

  return async (args: string[], opts?: RunOptions): Promise<CliResult> => {
    const timeout = opts?.timeoutMs ?? baseTimeout;
    try {
      const { stdout, stderr } = await execFn("container", args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & {
        stderr?: string;
        stdout?: string;
        killed?: boolean;
        signal?: string;
      };
      if (e.code === "ENOENT") {
        throw new CliError("container CLI not found", NOT_INSTALLED_HINT);
      }
      if (e.killed) {
        throw new CliError(
          `container ${args.join(" ")} timed out after ${timeout}ms. ` +
            `Long pulls/builds get a higher limit automatically; ` +
            `set CONTAINER_MCP_TIMEOUT_MS to raise the base limit.`
        );
      }
      if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        throw new CliError(
          `container ${args.join(" ")} produced more than 10MB of output. ` +
            `Output exceeded 10MB. For logs, use the tail parameter.`
        );
      }
      const stderr = (e.stderr || e.message || "").trim();
      const stdoutTail = (e.stdout ?? "").trim().slice(-2000);
      const hint = /not running|connection|XPC|daemon|apiserver/i.test(stderr)
        ? SERVICE_HINT
        : undefined;
      const exitCodePart = typeof e.code === "number" ? ` (exit ${e.code})` : "";
      const stdoutPart = stdoutTail ? `\nstdout (last 2000 chars):\n${stdoutTail}` : "";
      const cliErr = new CliError(
        `container ${args.join(" ")} failed${exitCodePart}: ${stderr}${stdoutPart}`,
        hint
      );
      if (typeof e.code === "number") {
        cliErr.exitCode = e.code;
      }
      throw cliErr;
    }
  };
}

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CliRunner } from "../cli.js";
import type { Config } from "../config.js";

export interface ToolContext {
  run: CliRunner;
  config: Config;
}

export function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

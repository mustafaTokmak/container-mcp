import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CliRunner } from "../cli.js";
import type { Config } from "../config.js";

export interface ToolContext {
  run: CliRunner;
  config: Config;
  sessionId: string;
  getClient: () => string;
}

export function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

export function okStructured(
  text: string,
  data: { exitCode: number; stdout: string; stderr: string }
): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: data };
}

export function failStructured(
  message: string,
  data: { exitCode: number | null; stdout: string; stderr: string }
): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true, structuredContent: data };
}

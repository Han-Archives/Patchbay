import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Every tool in this package returns its payload as a single pretty-printed JSON text block. */
export function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

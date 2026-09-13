import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";

/**
 * In-process MCP test harness (spec Phase 6 acceptance criteria): a real
 * `Client` talking to a real `Server` over `InMemoryTransport`'s linked
 * pair, no stdio/subprocess involved. Used by every `tools/*.test.ts` file.
 */
export interface InProcessMcp {
  client: Client;
  close: () => Promise<void>;
}

export async function connectInProcess(studioHome: string): Promise<InProcessMcp> {
  const server = createServer(studioHome);
  const client = new Client({ name: "patchbay-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * Calls a tool with the concrete `CallToolResult` schema, and casts the
 * result to `CallToolResult`: `Client.callTool`'s declared return type is a
 * union with a task/`toolResult` variant (for task-based tools), which none
 * of this package's tools are -- every tool here always returns the plain
 * `content`-array shape at runtime, passing `CallToolResultSchema`
 * guarantees that on the wire, and the cast just says so to the type
 * checker.
 */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: args }, CallToolResultSchema);
  return result as CallToolResult;
}

/** The raw text of a tool result's first (and only, for this package's tools) content block. */
export function resultText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error(`Expected a single text content block, got: ${JSON.stringify(result.content)}`);
  }
  return first.text;
}

/** Parses a tool result's first (and only, for this package's tools) text content block as JSON. */
export function resultJson(result: CallToolResult): unknown {
  return JSON.parse(resultText(result));
}

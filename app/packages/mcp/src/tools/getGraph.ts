import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { computeGraphResult, resolveLevel, resolveRegisteredProject, type Level } from "./shared.js";

const inputShape = {
  alias: z.string().optional().describe("Registered project alias. Omitted -> the sole registered project."),
  level: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional()
    .describe(
      "1 = summary counts (default), 2 = full node/edge FlowGraph JSON, 3 = raw inferred.json.",
    ),
};

/**
 * `get_graph` (spec 8.5): "Flow용 노드/엣지 JSON" (structured node/edge JSON
 * for Flow) -- the structured `computeFlowGraph` data, never rendered
 * Mermaid text. Default `level` is 1 (summary counts).
 */
export function registerGetGraphTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "get_graph",
    {
      title: "Get Graph",
      description:
        "Returns a registered project's Flow graph (node/edge JSON, not rendered Mermaid text). " +
        "level 1 (default) = summary counts, 2 = full graph, 3 = raw inferred.json.",
      inputSchema: inputShape,
    },
    async ({ alias, level }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      const resolvedLevel: Level = resolveLevel(level, 1);
      const result = await computeGraphResult(studioHome, registered.alias, resolvedLevel);
      return jsonResult({ alias: registered.alias, level: resolvedLevel, ...result });
    },
  );
}

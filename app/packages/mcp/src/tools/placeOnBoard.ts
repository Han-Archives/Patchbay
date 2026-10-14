import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { placeOnBoard } from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";

const inputShape = {
  alias: z.string().describe("Registered project alias. Required."),
  id: z.string().min(1).describe("Unique on this board. Same id is a no-op."),
  kind: z.enum(["langgraph", "neo4j", "port"]).describe("langgraph | neo4j | port."),
  ref: z.string().min(1).describe("Source-side address. PortId if kind is port, otherwise a string."),
  title: z.string().min(1).describe("Label shown on the board."),
  x: z.number().int().optional().describe("CSS-pixel x. Integer. Default 0."),
  y: z.number().int().optional().describe("CSS-pixel y. Integer. Default 0."),
};

/**
 * `place_on_board` (spec 5 / P4): appends one item to board.yaml.
 * Same id is a no-op and does not rewrite the file.
 */
export function registerPlaceOnBoardTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "place_on_board",
    {
      title: "Place on board",
      description:
        "Adds an item to a registered project's board.yaml. If an item with the same id is already there, " +
        "this is a no-op. Coordinates default to 0,0. Does not invoke LangGraph or query Neo4j.",
      inputSchema: inputShape,
    },
    async ({ alias, id, kind, ref, title, x, y }) => {
      const result = await placeOnBoard(studioHome, alias, { id, kind, ref, title, x, y });
      return jsonResult(result);
    },
  );
}

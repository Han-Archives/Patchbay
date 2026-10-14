import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult } from "./result.js";
import { readAtlasContent, resolveLevel, resolveRegisteredProject, type Level } from "./shared.js";

const inputShape = {
  alias: z.string().optional().describe("Registered project alias. Omitted -> the sole registered project."),
  level: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional()
    .describe("1 = digest (default), 2 = full ATLAS.md, 3 = raw inferred.json."),
};

/**
 * `get_atlas` (spec 8.5): "Atlas 요약" (Atlas summary). Default `level` is
 * **1** here -- deliberately different from the CLI `atlas` command's
 * default of L2 (`packages/cli/src/commands/atlas.ts`). That difference is
 * spec'd, not a bug (Phase 4 checklist: "CLI atlas 기본은 L2 파일. MCP
 * get_atlas 기본 level=1.").
 */
export function registerGetAtlasTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "get_atlas",
    {
      title: "Get Atlas",
      description:
        "Returns a registered project's Atlas summary. level 1 (default) = digest counts, " +
        "2 = full Atlas markdown, 3 = raw inferred.json.",
      inputSchema: inputShape,
    },
    async ({ alias, level }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      const resolvedLevel: Level = resolveLevel(level, 1);
      const content = await readAtlasContent(studioHome, registered.alias, resolvedLevel);
      return jsonResult({ alias: registered.alias, level: resolvedLevel, content });
    },
  );
}

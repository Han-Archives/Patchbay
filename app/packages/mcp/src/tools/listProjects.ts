import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readStudio } from "@patchbay/core";
import { jsonResult } from "./result.js";

/**
 * `list_projects` (spec 8.5): "스튜디오 레지스트리" -- the studio registry,
 * as-is. No parameters. Returns `{ projects: StudioRegisteredProject[] }`,
 * straight from `readStudio` -- no filtering, no derived fields.
 */
export function registerListProjectsTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "Lists every project registered with this Patchbay studio (the studio registry).",
      inputSchema: {},
    },
    async () => {
      const studio = await readStudio(studioHome);
      return jsonResult({ projects: studio.projects });
    },
  );
}

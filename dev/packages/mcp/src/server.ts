import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveStudioHome } from "@patchbay/core";
import { registerGetAtlasTool } from "./tools/getAtlas.js";
import { registerGetGraphTool } from "./tools/getGraph.js";
import { registerGetProgressTool } from "./tools/getProgress.js";
import { registerGetProjectBundleTool } from "./tools/getProjectBundle.js";
import { registerListProjectsTool } from "./tools/listProjects.js";

/**
 * Patchbay's MCP wrapper (spec Phase 6, +`get_progress` in Phase 7): five
 * read-only tools -- `list_projects`, `get_atlas`, `get_graph`,
 * `get_project_bundle`, `get_progress` -- all built on `@patchbay/core`. No
 * `patch_skill`/`record_decision` here (later phases); no LLM calls.
 *
 * Deliberately separate from connecting to a transport (spec Phase 6
 * acceptance criteria) so tests can drive a real `Server` in-process (e.g.
 * via `InMemoryTransport.createLinkedPair()`) without spawning stdio.
 */
export function createServer(studioHome: string = resolveStudioHome()): McpServer {
  const server = new McpServer({ name: "patchbay", version: "0.0.0" });

  registerListProjectsTool(server, studioHome);
  registerGetAtlasTool(server, studioHome);
  registerGetGraphTool(server, studioHome);
  registerGetProjectBundleTool(server, studioHome);
  registerGetProgressTool(server, studioHome);

  return server;
}

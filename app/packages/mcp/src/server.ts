import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveStudioHome } from "@patchbay/core";
import { registerFindDocumentsTool } from "./tools/findDocuments.js";
import { registerGetAtlasTool } from "./tools/getAtlas.js";
import { registerGetGraphTool } from "./tools/getGraph.js";
import { registerGetImpactTool } from "./tools/getImpact.js";
import { registerGetProgressTool } from "./tools/getProgress.js";
import { registerGetProjectBundleTool } from "./tools/getProjectBundle.js";
import { registerGetRunsTool } from "./tools/getRuns.js";
import { registerListProjectsTool } from "./tools/listProjects.js";
import { registerPlaceOnBoardTool } from "./tools/placeOnBoard.js";
import { registerProgressWriteTool } from "./tools/progressWrite.js";
import { registerThreadTools } from "./tools/threads.js";
import { registerConsultTools } from "./tools/consult.js";
import { registerRoomTools } from "./tools/rooms.js";
import { registerSessionTools, SESSION_INSTRUCTIONS, type LlmRun } from "./tools/session.js";

/**
 * Patchbay's MCP wrapper: read tools plus writes (`progress_write`,
 * `place_on_board`, `answer_request`, `consult_update` — the design draft only,
 * `room_bind` — which room a Claude Code session is mirrored into). All go through `@patchbay/core`.
 * No LLM calls, except `llm_status` with `probe` (one tiny call per host the caller names). Overlay is not written here -- `decisions` has a writer in
 * Core and the CLI (`patchbay decision add`), and stays out of MCP on
 * purpose (명세 5: 확정 overlay를 MCP가 덮지 않는다).
 *
 * Deliberately separate from connecting to a transport so tests can drive a
 * real `Server` in-process via `InMemoryTransport.createLinkedPair()`.
 */
export function createServer(studioHome: string = resolveStudioHome(), deps: { llmRunner?: LlmRun } = {}): McpServer {
  // 세션 규칙은 서버 안내로 같이 간다 — 세션이 어느 폴더에서 켜졌든 MCP가 붙으면 읽힌다.
  const server = new McpServer({ name: "patchbay", version: "0.0.0" }, { instructions: SESSION_INSTRUCTIONS });

  registerListProjectsTool(server, studioHome);
  registerGetAtlasTool(server, studioHome);
  registerGetGraphTool(server, studioHome);
  registerGetProjectBundleTool(server, studioHome);
  registerGetProgressTool(server, studioHome);
  registerGetImpactTool(server, studioHome);
  registerFindDocumentsTool(server, studioHome);
  registerGetRunsTool(server, studioHome);
  registerProgressWriteTool(server, studioHome);
  registerPlaceOnBoardTool(server, studioHome);
  registerThreadTools(server, studioHome);
  registerConsultTools(server, studioHome);
  registerRoomTools(server, studioHome);
  registerSessionTools(server, studioHome, deps.llmRunner ? { runner: deps.llmRunner } : {});

  return server;
}

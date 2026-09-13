import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readSignalExcerpts } from "@patchbay/core";
import { z } from "zod";
import { jsonResult } from "./result.js";
import {
  computeGraphResult,
  readAtlasContent,
  readInferredOrThrow,
  resolveLevel,
  resolveRegisteredProject,
  type Level,
} from "./shared.js";

const SCOPES = ["summary", "full"] as const;
type Scope = (typeof SCOPES)[number];

const inputShape = {
  alias: z.string().optional().describe("Registered project alias. Omitted -> the sole registered project."),
  level: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional()
    .describe("Same per-level meaning as get_atlas/get_graph. 1 = digest/summary counts (default)."),
  scope: z
    .enum(SCOPES)
    .optional()
    .describe(
      "\"summary\" (atlas + graph only) or \"full\" (default: adds file excerpts from discovered signal files).",
    ),
};

function resolveScope(raw: Scope | undefined): Scope {
  return raw ?? "full";
}

/**
 * `get_project_bundle` (spec 8.5): "제안용 재료" (material for a proposal) --
 * a scan summary plus, at `scope: "full"`, excerpts of the project's
 * discovered signal files (README/AGENTS.md/CLAUDE.md/`.cursor/rules`).
 *
 * The spec's table names the `level`/`scope` parameters but never defines
 * `scope`'s values -- a genuine spec gap. Filled in here per the project
 * lead's decision (Phase 6 task description): `scope` is `"summary" |
 * "full"`, default `"full"`.
 *
 *   - "summary": `{ alias, level, scope, atlas, graph }` -- `atlas` is the
 *     same content `get_atlas` would return for this alias/level; `graph`
 *     is the same per-level result `get_graph` would return (minus the
 *     redundant alias/level wrapper, since this bundle already carries
 *     those at the top level). No file reads beyond what get_atlas/get_graph
 *     already do.
 *   - "full": everything in "summary", plus `excerpts` -- one entry per
 *     `source:` kind PortId in `inferred.discoveredPorts`, read fresh from
 *     the registered project's real path via Core's
 *     `readSignalExcerpts` (capped at 2000 chars each).
 */
export function registerGetProjectBundleTool(server: McpServer, studioHome: string): void {
  server.registerTool(
    "get_project_bundle",
    {
      title: "Get project bundle",
      description:
        "Returns proposal material for a registered project: an Atlas + Graph summary, and (scope=full, " +
        "the default) excerpts of its discovered signal files (README/AGENTS.md/CLAUDE.md/.cursor/rules).",
      inputSchema: inputShape,
    },
    async ({ alias, level, scope }) => {
      const { registered } = await resolveRegisteredProject(studioHome, alias);
      const resolvedLevel: Level = resolveLevel(level, 1);
      const resolvedScope = resolveScope(scope);

      const [atlas, graph] = await Promise.all([
        readAtlasContent(studioHome, registered.alias, resolvedLevel),
        computeGraphResult(studioHome, registered.alias, resolvedLevel),
      ]);

      if (resolvedScope === "summary") {
        return jsonResult({ alias: registered.alias, level: resolvedLevel, scope: resolvedScope, atlas, graph });
      }

      const inferred = await readInferredOrThrow(studioHome, registered.alias);
      const excerpts = await readSignalExcerpts(registered.path, inferred.discoveredPorts);

      return jsonResult({
        alias: registered.alias,
        level: resolvedLevel,
        scope: resolvedScope,
        atlas,
        graph,
        excerpts,
      });
    },
  );
}

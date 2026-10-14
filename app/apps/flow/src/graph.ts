import { computeFlowGraph, readInferred, readOverlay, readStudio, resolveProjectAlias, type FlowGraph } from "@patchbay/core";

/**
 * Reads exactly the same node/edge JSON `get_graph` (MCP, level 2) and
 * `FLOW.md`'s Mermaid rendering are both built from (spec Phase 10: "같은
 * 그래프 JSON을 읽기만 함") -- this viewer introduces no new data model, it
 * only draws `computeFlowGraph`'s output on a pan/zoom canvas instead of a
 * static Mermaid flowchart.
 *
 * Throws a plain `Error` (caller-facing message from `resolveProjectAlias`)
 * on an unresolvable alias -- same contract as the MCP tools' own
 * `resolveRegisteredProject`.
 */
export async function loadGraph(studioHome: string, aliasArg?: string): Promise<{ alias: string; graph: FlowGraph }> {
  const studio = await readStudio(studioHome);
  const resolution = resolveProjectAlias(studio, aliasArg);
  if (!resolution.ok) {
    throw new Error(resolution.message);
  }

  const inferred = await readInferred(studioHome, resolution.alias);
  const overlay = await readOverlay(studioHome, resolution.alias);
  return { alias: resolution.alias, graph: computeFlowGraph(inferred, overlay) };
}

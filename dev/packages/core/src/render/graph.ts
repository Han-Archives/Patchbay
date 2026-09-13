import { createHash } from "node:crypto";
import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import type { PortId } from "../types/portId.js";

/**
 * `n` + the first 12 hex chars of `sha1(portId)`, lowercase, no underscore.
 * Extracted from `flowRenderer.ts`'s `renderFlow` (Phase 6) -- must stay
 * byte-identical, since `renderFlow`'s existing output (and its own test
 * suite) depends on exactly this id scheme.
 */
function nodeIdFor(portId: PortId): string {
  const hex = createHash("sha1").update(portId).digest("hex");
  return `n${hex.slice(0, 12)}`;
}

export interface FlowGraphNode {
  id: string;
  portId: PortId;
}

/** `from`/`to` are node ids (see `FlowGraphNode.id`), not raw PortIds. */
export interface FlowGraphEdge {
  from: string;
  to: string;
  kind: string;
}

export interface FlowGraph {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
}

/**
 * Structured node/edge graph for Flow (spec 8.5's `get_graph` MCP tool,
 * Phase 6): the same "what wires to what" data `renderFlow` turns into a
 * Mermaid flowchart, but as plain data instead of rendered text.
 *
 * Node order mirrors `renderFlow`'s pre-Phase-6 behavior exactly: one node
 * per `Inferred.discoveredPorts` entry first, then any additional endpoint
 * introduced by an `Overlay.patches`/`Overlay.wires` entry that wasn't
 * already in `discoveredPorts` (e.g. an `artifact:` patch target). Edges are
 * `Overlay.patches` followed by `Overlay.wires`, in order, one per entry.
 *
 * Pure function -- no I/O, no LLM calls.
 */
export function computeFlowGraph(inferred: Inferred, overlay: Overlay): FlowGraph {
  const nodeIds = new Map<PortId, string>();
  const nodes: FlowGraphNode[] = [];

  function ensureNode(portId: PortId): string {
    let id = nodeIds.get(portId);
    if (id === undefined) {
      id = nodeIdFor(portId);
      nodeIds.set(portId, id);
      nodes.push({ id, portId });
    }
    return id;
  }

  for (const port of inferred.discoveredPorts) {
    ensureNode(port);
  }

  const edges: FlowGraphEdge[] = [];
  for (const entry of [...overlay.patches, ...overlay.wires]) {
    const fromId = ensureNode(entry.from);
    const toId = ensureNode(entry.to);
    edges.push({ from: fromId, to: toId, kind: entry.kind });
  }

  return { nodes, edges };
}

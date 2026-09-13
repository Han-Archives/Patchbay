import { createHash } from "node:crypto";
import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import type { PortId } from "../types/portId.js";

/** `n` + the first 12 hex chars of `sha1(portId)`, lowercase, no underscore. */
function nodeIdFor(portId: PortId): string {
  const hex = createHash("sha1").update(portId).digest("hex");
  return `n${hex.slice(0, 12)}`;
}

/**
 * Renders `FLOW.md` (architecture mode only -- no progress/timeline mode in
 * this phase, that's later) as a fenced Mermaid `flowchart` block:
 *
 *   - one node per `Inferred.discoveredPorts` entry (every kind -- the full
 *     "what exists" picture, not just unlabeled skills)
 *   - one edge per `Overlay.patches` + `Overlay.wires` entry, labeled with
 *     its `kind`; both endpoint nodes are declared even if a PortId (e.g. an
 *     `artifact:` patch target) never appeared in `discoveredPorts`
 *
 * Pure function -- no I/O, no LLM calls. Produces a syntactically valid
 * (if trivial) diagram even with zero ports and zero patches/wires.
 */
export function renderFlow(inferred: Inferred, overlay: Overlay): string {
  const nodeIds = new Map<PortId, string>();
  const nodeOrder: PortId[] = [];

  function ensureNode(portId: PortId): string {
    let id = nodeIds.get(portId);
    if (id === undefined) {
      id = nodeIdFor(portId);
      nodeIds.set(portId, id);
      nodeOrder.push(portId);
    }
    return id;
  }

  for (const port of inferred.discoveredPorts) {
    ensureNode(port);
  }

  const edgeLines: string[] = [];
  for (const entry of [...overlay.patches, ...overlay.wires]) {
    const fromId = ensureNode(entry.from);
    const toId = ensureNode(entry.to);
    edgeLines.push(`  ${fromId} -->|${entry.kind}| ${toId}`);
  }

  const nodeLines = nodeOrder.map((portId) => `  ${nodeIds.get(portId)}["${portId}"]`);

  const lines = ["```mermaid", "flowchart TD", ...nodeLines, ...edgeLines, "```", ""];
  return lines.join("\n");
}

import type { Inferred } from "../types/inferred.js";
import type { Overlay } from "../types/overlay.js";
import { computeFlowGraph } from "./graph.js";

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
 * Node id generation and edge construction live in `graph.ts`'s
 * `computeFlowGraph` (Phase 6, extracted from here the same way Phase 4
 * extracted Atlas's L1/L2 shared aggregation into `layers.ts`) -- this
 * function is now just the Mermaid text formatting on top of that shared
 * structure. Output is byte-identical to the pre-Phase-6 inline version.
 *
 * Pure function -- no I/O, no LLM calls. Produces a syntactically valid
 * (if trivial) diagram even with zero ports and zero patches/wires.
 */
export function renderFlow(inferred: Inferred, overlay: Overlay): string {
  const { nodes, edges } = computeFlowGraph(inferred, overlay);

  const nodeLines = nodes.map((node) => `  ${node.id}["${node.portId}"]`);
  const edgeLines = edges.map((edge) => `  ${edge.from} -->|${edge.kind}| ${edge.to}`);

  const lines = ["```mermaid", "flowchart TD", ...nodeLines, ...edgeLines, "```", ""];
  return lines.join("\n");
}

/** `c` + the commit's position in chronological (oldest-first) order, 0-based. Not a PortId, so it doesn't need to match `nodeIdFor`'s sha1 scheme. */
function progressNodeIdFor(chronologicalIndex: number): string {
  return `c${chronologicalIndex}`;
}

/**
 * Sanitizes a commit subject for use as a Mermaid quoted node label:
 * collapses internal whitespace/newlines to single spaces, truncates to a
 * reasonable length, and swaps `"` for `'` so it can't break out of the
 * `["..."]` label syntax.
 */
function sanitizeMermaidLabel(subject: string): string {
  const oneLine = subject.replace(/\s+/g, " ").trim().replace(/"/g, "'");
  const MAX_LENGTH = 72;
  return oneLine.length > MAX_LENGTH ? `${oneLine.slice(0, MAX_LENGTH - 3)}...` : oneLine;
}

/**
 * Renders `FLOW.md`'s progress-mode Mermaid block (spec 5.2: "same data,
 * two modes" -- architecture mode above shows the wiring, this shows
 * current position via git activity). `Inferred.git.recentCommitSubjects`
 * is subject strings only, most-recent-first, with no timestamps (spec
 * 7.8) -- so "timeline" here means an ordered sequence, not a date axis.
 *
 * Ordering: the array is most-recent-first; this function reverses it to
 * render oldest-to-newest (chronological, top-to-bottom -- "how we got to
 * now"), one node per commit subject, connected in a single chain.
 *
 * Pure function -- no I/O, no LLM calls. Produces a syntactically valid (if
 * trivial) diagram even with zero commits.
 */
export function renderFlowProgress(inferred: Inferred): string {
  const chronological = [...inferred.git.recentCommitSubjects].reverse();

  const nodeLines = chronological.map(
    (subject, index) => `  ${progressNodeIdFor(index)}["${sanitizeMermaidLabel(subject)}"]`,
  );
  const edgeLines: string[] = [];
  for (let index = 0; index < chronological.length - 1; index++) {
    edgeLines.push(`  ${progressNodeIdFor(index)} --> ${progressNodeIdFor(index + 1)}`);
  }

  const lines = ["```mermaid", "flowchart TD", ...nodeLines, ...edgeLines, "```", ""];
  return lines.join("\n");
}

/**
 * Renders the full contents of `FLOW.md`: the architecture-mode block
 * (`renderFlow`, byte-identical to its pre-Phase-5 output) followed by a
 * `## Progress` heading and the progress-mode block (`renderFlowProgress`).
 * There is only one `FLOW.md` per project (spec file tree) -- both views
 * live in it rather than a second file. This is what `project add`/`scan`
 * write to disk; `renderFlow` itself stays architecture-mode-only for
 * existing callers.
 */
export function renderFlowFile(inferred: Inferred, overlay: Overlay): string {
  const architecture = renderFlow(inferred, overlay);
  const progress = renderFlowProgress(inferred);
  return `${architecture}\n## Progress\n\n${progress}`;
}

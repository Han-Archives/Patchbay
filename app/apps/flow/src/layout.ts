export interface FlowGraphNode {
  id: string;
  portId: string;
}
export interface FlowGraphEdge {
  from: string;
  to: string;
  kind: string;
}
export interface FlowGraph {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
}

export interface Position {
  x: number;
  y: number;
}

export const COLUMN_WIDTH = 260;
export const ROW_HEIGHT = 90;

/**
 * Deterministic layered layout, pure/no-JSX so it's testable on its own
 * (`App.tsx` just draws whatever this returns). No dagre/elk dependency:
 * nodes with no incoming edge sit in column 0, everything else is placed
 * one column past its furthest-upstream predecessor -- same spirit as
 * Mermaid's own top-down flowchart layering, just laid out left-to-right
 * on a pan/zoom canvas instead of rendered as static text (spec Phase 10:
 * this is the exact same `FlowGraph` JSON Mermaid draws from, nothing new
 * is computed here beyond node positions).
 */
export function layout(nodes: FlowGraphNode[], edges: FlowGraphEdge[]): Map<string, Position> {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n.id, 0);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    outgoing.get(e.from)?.push(e.to);
  }

  const column = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((indegree.get(n.id) ?? 0) === 0) {
      column.set(n.id, 0);
      queue.push(n.id);
    }
  }

  const remaining = new Map(indegree);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    const col = column.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      if ((column.get(next) ?? -1) < col + 1) column.set(next, col + 1);
      const left = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  // Anything left unvisited is part of a cycle -- park it in column 0 rather than dropping it.
  for (const n of nodes) if (!column.has(n.id)) column.set(n.id, 0);

  const rowInColumn = new Map<number, number>();
  const positions = new Map<string, Position>();
  for (const n of nodes) {
    const col = column.get(n.id) ?? 0;
    const row = rowInColumn.get(col) ?? 0;
    rowInColumn.set(col, row + 1);
    positions.set(n.id, { x: col * COLUMN_WIDTH, y: row * ROW_HEIGHT });
  }
  return positions;
}

/** Fill color by PortId kind (the part before ":") -- purely visual, no new semantics beyond what Atlas/Flow already draw from `kind`. */
export const KIND_COLORS: Record<string, string> = {
  source: "#5B8DEF",
  skill: "#2F9E6E",
  artifact: "#C77D2E",
  agent: "#9B5DE5",
  signal: "#E0507A",
};
export const DEFAULT_KIND_COLOR = "#6B7785";

export function kindOf(portId: string): string {
  const i = portId.indexOf(":");
  return i === -1 ? "" : portId.slice(0, i);
}

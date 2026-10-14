import { layout } from "./layout.js";
import type { ComparedFlow, FlowLane } from "./compareFlow.js";
import type { FlowGraphView } from "./langgraphContract.js";

export interface FlowCanvasNode {
  id: string;
  type: "langgraph";
  position: { x: number; y: number };
  data: { label: string; current: boolean; lane: FlowLane; actualLabel?: string };
  className?: string;
}

export interface FlowCanvasEdge {
  id: string;
  source: string;
  target: string;
  className?: string;
  style?: { strokeDasharray?: string };
}

function classNames(...parts: Array<string | undefined | false>): string | undefined {
  const joined = parts.filter(Boolean).join(" ");
  return joined || undefined;
}

export function toComparedFlowCanvas(
  compared: ComparedFlow,
  currentNodes: readonly string[],
): { nodes: FlowCanvasNode[]; edges: FlowCanvasEdge[] } {
  const current = new Set(currentNodes);
  const positions = layout(
    compared.nodes.map((node) => ({ id: node.id, portId: node.label })),
    compared.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.lane })),
  );
  const nodes: FlowCanvasNode[] = compared.nodes.map((node) => {
    const isCurrent = current.has(node.id);
    return {
      id: node.id,
      type: "langgraph",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        label: node.label,
        current: isCurrent,
        lane: node.lane,
        actualLabel: node.actualLabel,
      },
      className: classNames(`flow-node-${node.lane}`, isCurrent && "flow-node-current"),
    };
  });
  const edges: FlowCanvasEdge[] = compared.edges.map((edge) => {
    const canvasEdge: FlowCanvasEdge = {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      className: `flow-edge-${edge.lane}`,
    };
    if (edge.lane === "plan") canvasEdge.style = { strokeDasharray: "6 4" };
    return canvasEdge;
  });
  return { nodes, edges };
}

/**
 * Positions come from the existing layered `layout()` — same algorithm as the
 * scan-graph viewer, applied to LangGraph node ids (not PortIds).
 */
export function toFlowCanvas(
  graph: FlowGraphView,
  currentNodes: readonly string[],
): { nodes: FlowCanvasNode[]; edges: FlowCanvasEdge[] } {
  return toComparedFlowCanvas(
    {
      nodes: graph.nodes.map((node) => ({ id: node.id, label: node.label, lane: "actual" })),
      edges: graph.edges.map((edge, index) => ({
        id: `${edge.from}->${edge.to}:${index}`,
        from: edge.from,
        to: edge.to,
        lane: "actual",
      })),
    },
    currentNodes,
  );
}

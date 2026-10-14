import type { ProcessView } from "./projectContract.js";
import type { FlowGraphNodeView, FlowGraphView } from "./langgraphContract.js";

export type FlowLane = "plan" | "actual" | "both";

export interface ComparedFlowNode {
  id: string;
  label: string;
  actualLabel?: string;
  lane: FlowLane;
}

export interface ComparedFlowEdge {
  id: string;
  from: string;
  to: string;
  lane: FlowLane;
}

export interface ComparedFlow {
  nodes: ComparedFlowNode[];
  edges: ComparedFlowEdge[];
}

export function sequentialEdges(steps: Array<{ id: string }>): Array<{ from: string; to: string }> {
  return steps.slice(0, -1).map((step, index) => ({ from: step.id, to: steps[index + 1]!.id }));
}

export function planGraphFromProcess(process: ProcessView): FlowGraphView {
  return {
    nodes: process.steps.map((step) => ({ id: step.id, label: step.label })),
    edges: process.edges.length > 0 ? process.edges : sequentialEdges(process.steps),
  };
}

export function runtimeGraph(graph: FlowGraphView): FlowGraphView {
  const skip = (id: string) => id.startsWith("__");
  return {
    nodes: graph.nodes.filter((node) => !skip(node.id)),
    edges: graph.edges.filter((edge) => !skip(edge.from) && !skip(edge.to)),
  };
}

function resolveActualId(
  plan: FlowGraphNodeView,
  actualById: Map<string, FlowGraphNodeView>,
  actualByLabel: Map<string, FlowGraphNodeView>,
  bind: Record<string, string>,
  claimed: Set<string>,
): string | null {
  const candidates = [bind[plan.id], plan.id, actualByLabel.get(plan.label)?.id, actualByLabel.get(plan.id)?.id];
  for (const candidate of candidates) {
    if (!candidate || !actualById.has(candidate) || claimed.has(candidate)) continue;
    return candidate;
  }
  return null;
}

/**
 * Overlay the intended process on the LangGraph graph. Shared nodes/edges
 * are `both`; leftovers keep their lane so a detour is visible.
 */
export function compareFlowGraphs(
  plan: FlowGraphView,
  actual: FlowGraphView,
  bind: Record<string, string> = {},
): ComparedFlow {
  const actualById = new Map(actual.nodes.map((node) => [node.id, node]));
  const actualByLabel = new Map(actual.nodes.map((node) => [node.label, node]));
  const claimed = new Set<string>();
  const planToCanvas = new Map<string, string>();

  const nodes: ComparedFlowNode[] = [];
  const seen = new Set<string>();

  for (const step of plan.nodes) {
    const actualId = resolveActualId(step, actualById, actualByLabel, bind, claimed);
    if (actualId) {
      claimed.add(actualId);
      planToCanvas.set(step.id, actualId);
      const runtime = actualById.get(actualId)!;
      nodes.push({
        id: actualId,
        label: step.label,
        actualLabel: runtime.label !== step.label ? runtime.label : undefined,
        lane: "both",
      });
      seen.add(actualId);
    } else {
      const id = `plan:${step.id}`;
      planToCanvas.set(step.id, id);
      nodes.push({ id, label: step.label, lane: "plan" });
      seen.add(id);
    }
  }

  for (const node of actual.nodes) {
    if (seen.has(node.id)) continue;
    nodes.push({ id: node.id, label: node.label, lane: "actual" });
    seen.add(node.id);
  }

  const edgeKey = (from: string, to: string) => `${from}\0${to}`;
  const planEdgeSet = new Set<string>();
  const actualEdgeSet = new Set<string>();

  for (const edge of plan.edges) {
    const from = planToCanvas.get(edge.from);
    const to = planToCanvas.get(edge.to);
    if (from && to) planEdgeSet.add(edgeKey(from, to));
  }
  for (const edge of actual.edges) {
    if (seen.has(edge.from) && seen.has(edge.to)) {
      actualEdgeSet.add(edgeKey(edge.from, edge.to));
    }
  }

  const edges: ComparedFlowEdge[] = [];
  const allKeys = new Set([...planEdgeSet, ...actualEdgeSet]);
  let index = 0;
  for (const key of allKeys) {
    const [from, to] = key.split("\0") as [string, string];
    const inPlan = planEdgeSet.has(key);
    const inActual = actualEdgeSet.has(key);
    const lane: FlowLane = inPlan && inActual ? "both" : inPlan ? "plan" : "actual";
    edges.push({ id: `${lane}:${from}->${to}:${index}`, from, to, lane });
    index += 1;
  }

  return { nodes, edges };
}

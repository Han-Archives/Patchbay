import { layout } from "./layout.js";
import type { Ir } from "./irContract.js";

/**
 * The IR's nodes and edges as canvas items, reusing the console's existing
 * `layout()` (the same Kahn ranking the 흐름 tab uses) rather than adding a
 * second graph engine -- 구현준비 M3: 「관계는 기존 XYFlow로 먼저 그린다」.
 *
 * `__start__`/`__end__` are drawn even though they are not in `nodes[]`: a
 * reader checking 1.5 ("does every node reach the end?") needs to see the two
 * terminals the reachability check measures against.
 */

export interface IrCanvasNode {
  id: string;
  type: "irnode";
  position: { x: number; y: number };
  data: {
    label: string;
    terminal: boolean;
    /** Model-calling nodes are where 1.2's caps and the timeout actually bite. */
    models: string[];
    tools: string[];
    documents: number;
    reads: string[];
    writes: string[];
  };
  className?: string;
}

export interface IrCanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  className?: string;
}

export const IR_TERMINALS = ["__start__", "__end__"] as const;

/** 캔버스에 쓰는 노드 글자. 회로의 양 끝은 LangGraph 이름 대신 「시작」 「끝」으로 읽힌다. */
export function irNodeText(node: IrCanvasNode): string {
  if (node.id === "__start__") return "시작";
  if (node.id === "__end__") return "끝";
  return node.data.terminal ? node.id : `${node.id} · ${node.data.label}`;
}

/**
 * 연결 이름은 노드 사이 간격 안에 들어가야 한다 — 긴 조건 문장이 옆 노드를 덮었다 (디자인 개편
 * 걷기 06). 원문은 1.5 표와 승인본에 그대로 있고, 캔버스는 알아보는 만큼만 싣는다.
 */
export function shortEdgeLabel(label: string | undefined, max = 10): string | undefined {
  if (!label) return label;
  const chars = Array.from(label);
  return chars.length <= max ? label : `${chars.slice(0, max).join("")}…`;
}

export function toIrCanvas(ir: Ir): { nodes: IrCanvasNode[]; edges: IrCanvasEdge[] } {
  const declared = new Map(ir.nodes.map((node) => [node.id, node]));
  const mentioned = new Set<string>([...declared.keys()]);
  for (const edge of ir.edges) {
    mentioned.add(edge.from);
    mentioned.add(edge.to);
  }

  const positions = layout(
    [...mentioned].map((id) => ({ id, portId: id })),
    ir.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: "ir" })),
  );

  const nodes: IrCanvasNode[] = [...mentioned].map((id) => {
    const node = declared.get(id);
    const terminal = (IR_TERMINALS as readonly string[]).includes(id);
    return {
      id,
      type: "irnode",
      position: positions.get(id) ?? { x: 0, y: 0 },
      data: {
        label: node?.label ? `${node.label}` : id,
        terminal,
        models: node?.models ?? [],
        tools: node?.tools ?? [],
        documents: node?.documents.length ?? 0,
        reads: node?.reads ?? [],
        writes: node?.writes ?? [],
      },
      className: terminal ? "ir-node-terminal" : node?.models.length ? "ir-node-model" : undefined,
    };
  });

  const edges: IrCanvasEdge[] = ir.edges.map((edge, index) => ({
    id: `${edge.from}->${edge.to}#${index}`,
    source: edge.from,
    target: edge.to,
    // 분기 조건은 선 위에 있어야 읽힌다 — 표로 빼면 어느 선인지 다시 찾아야 한다.
    label: edge.when,
    className: edge.when ? "ir-edge-branch" : undefined,
  }));

  return { nodes, edges };
}

/** Which State fields nobody reads, and which nobody writes. 1.4 → 1.5 어긋남이 여기서 보인다. */
export function stateTraffic(ir: Ir): Map<string, { readers: string[]; writers: string[] }> {
  const traffic = new Map<string, { readers: string[]; writers: string[] }>();
  for (const field of ir.state) traffic.set(field.field, { readers: [], writers: [] });
  for (const node of ir.nodes) {
    for (const field of node.reads) traffic.get(field)?.readers.push(node.id);
    for (const field of node.writes) traffic.get(field)?.writers.push(node.id);
  }
  return traffic;
}

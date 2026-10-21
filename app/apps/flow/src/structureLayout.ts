import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { RenderedView } from "./structureModel.js";

/**
 * 구조 · 흐름 장의 배치 (절차 `아키텍처-드릴다운-배치조사_20261017_v1` 「배치 엔진」): elkjs layered, 위→아래, 한 번에 그림 한 장.
 * 구조 장에는 콘솔↔커널처럼 오가는 선이 있어 지금 `layout.ts`(순환 노드를 0열에 몬다)로는 한 열에 몰린다.
 * React Flow는 선을 자기 곡선으로 다시 그리므로, elk가 돌려준 선 경로(시작 · 꺾는 점 · 끝)와 라벨 자리를 그대로 넘긴다.
 */
export const NODE_W = 168;
export const NODE_H = 56;
export const GAP_W = 96;
export const GAP_H = 32;

export interface LaidNode { id: string; x: number; y: number; width: number; height: number }
export interface LaidEdge { id: string; points: { x: number; y: number }[]; label: { x: number; y: number; width: number; height: number } | null }
export interface StructureLayout { nodes: LaidNode[]; edges: LaidEdge[]; width: number; height: number }

/** 라벨 크기를 elk에 넣어 라벨끼리 포개지지 않게 한다. 화면 글자 11px 기준: 한글 ≈ 11.5px, 그 밖 ≈ 6.5px, 좌우 여백 10px. */
export function labelWidth(text: string): number {
  return Math.ceil(10 + [...text].reduce((sum, ch) => sum + (/[\u3131-\uD7A3]/.test(ch) ? 11.5 : 6.5), 0));
}
function labelSize(text: string) { return { width: labelWidth(text), height: 18 }; }

const elk = new ELK();

export async function layoutStructure(view: Pick<RenderedView, "nodes" | "edges">): Promise<StructureLayout> {
  const input: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.spacing.nodeNode": "40",
      "elk.spacing.edgeEdge": "14",
      "elk.spacing.edgeLabel": "4",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: view.nodes.map(node => node.kind === "gap" ? { id: node.id, width: GAP_W, height: GAP_H } : { id: node.id, width: NODE_W, height: NODE_H }),
    edges: view.edges.map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target], labels: [{ text: edge.label, ...labelSize(`${edge.step ? `${edge.step}  ` : ""}${edge.label}${edge.effect ? (edge.effect === "write" ? " · 쓰기" : " · 읽기") : ""}`) }] })),
  };
  const graph = await elk.layout(input);
  const nodes = (graph.children ?? []).map(child => ({ id: child.id, x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? NODE_W, height: child.height ?? NODE_H }));
  const edges = (graph.edges ?? []).map(edge => {
    const section = edge.sections?.[0];
    const points = section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(p => ({ x: p.x, y: p.y })) : [];
    const label = edge.labels?.[0];
    return { id: edge.id, points, label: label && label.x !== undefined && label.y !== undefined ? { x: label.x, y: label.y, width: label.width ?? 0, height: label.height ?? 0 } : null };
  });
  return { nodes, edges, width: graph.width ?? 0, height: graph.height ?? 0 };
}

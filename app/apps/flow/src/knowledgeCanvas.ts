import { DEFAULT_KIND_COLOR, KIND_COLORS, layout } from "./layout.js";
import type { KnowledgeEdgeView, KnowledgeLabel, KnowledgeNodeView } from "./neo4jContract.js";

/**
 * Two families, two hue ranges. The scan replica keeps the colors the rest of
 * the console already uses for a file, a skill and an artifact; the four design
 * rows share one purple family, so「스캔이 찾은 것」과「사람이 적은 설계」가
 * 색으로 먼저 갈린다 -- which is what 3.5's warning is about.
 */
export const KNOWLEDGE_NODE_COLORS: Record<KnowledgeLabel, string> = {
  File: KIND_COLORS.source ?? DEFAULT_KIND_COLOR,
  Folder: DEFAULT_KIND_COLOR,
  Skill: KIND_COLORS.skill ?? DEFAULT_KIND_COLOR,
  Artifact: KIND_COLORS.artifact ?? DEFAULT_KIND_COLOR,
  AgentNode: KIND_COLORS.agent ?? DEFAULT_KIND_COLOR,
  Requirement: "#7B4BC4",
  Eval: "#5E3AA0",
  Document: "#C08AE8",
  // 실행 행 — 지금 할 일 색(주황) 계열: 테스트에서 들어온 사실이다.
  Run: "#E3A35A",
};

/** 화면에 내보내는 종류 이름. 그래프 라벨(영어)은 Neo4j 안의 이름이고, 사람은 이 말로 읽는다. */
export const KNOWLEDGE_LABEL_NAMES: Record<KnowledgeLabel, string> = {
  File: "파일",
  Folder: "폴더",
  Skill: "스킬",
  Artifact: "산출물",
  AgentNode: "노드",
  Requirement: "요구사항",
  Eval: "평가",
  Document: "문서",
  Run: "실행",
};

export interface KnowledgeCanvasNode {
  id: string;
  type: "knowledge";
  position: { x: number; y: number };
  data: { label: string; kind: KnowledgeLabel; current: boolean };
  className?: string;
}

export interface KnowledgeCanvasEdge {
  id: string;
  source: string;
  target: string;
  /** The relation's name. Without it CONSULTS and FLOWS_TO draw the same line. */
  label: string;
}

export function toKnowledgeCanvas(
  selected: KnowledgeNodeView | null,
  neighbors: readonly KnowledgeNodeView[],
  edges: readonly KnowledgeEdgeView[],
): { nodes: KnowledgeCanvasNode[]; edges: KnowledgeCanvasEdge[] } {
  if (!selected) return { nodes: [], edges: [] };
  const byPath = new Map<string, KnowledgeNodeView>();
  byPath.set(selected.path, selected);
  for (const node of neighbors) byPath.set(node.path, node);

  const graphNodes = [...byPath.values()].map((node) => ({ id: node.path, portId: node.label }));
  const graphEdges = edges
    .filter((edge) => byPath.has(edge.from) && byPath.has(edge.to))
    .map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind }));
  const positions = layout(graphNodes, graphEdges);

  const nodes: KnowledgeCanvasNode[] = [...byPath.values()].map((node) => {
    const current = node.path === selected.path;
    return {
      id: node.path,
      type: "knowledge",
      position: positions.get(node.path) ?? { x: 0, y: 0 },
      data: { label: node.name, kind: node.label, current },
      className: current ? "flow-node-current" : undefined,
    };
  });
  const canvasEdges: KnowledgeCanvasEdge[] = graphEdges.map((edge, index) => ({
    id: `${edge.from}->${edge.to}:${index}`,
    source: edge.from,
    target: edge.to,
    label: edge.kind,
  }));
  return { nodes, edges: canvasEdges };
}

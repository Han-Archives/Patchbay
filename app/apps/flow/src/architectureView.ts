import type { Ir } from "./irContract.js";
import { COLUMN_WIDTH, ROW_HEIGHT, type Position } from "./layout.js";
import type { FlowAssistantView, FlowThreadView, FlowViewConnected } from "./langgraphContract.js";

/**
 * 아키텍처 화면(B안, 사용자 결정 2026-10-16)이 그리는 것: 승인된 설계 그래프 위에 LangGraph 실행 상태를 겹친다.
 * 화면 코드가 IR을 직접 뒤지지 않게, 노드 하나가 닿는 것과 실행 상태를 여기서 모은다.
 */

/**
 * `layout()` 은 단계를 가로로 260px씩 벌린다. 이 화면의 그래프 칸은 세로로 길어서, 가로로 두면 6단 그래프가
 * 반 크기로 줄어 글자를 못 읽는다(2026-10-16 확인). 단계는 아래로, 같은 단계의 노드는 옆으로 놓는다.
 */
export const VERTICAL_COLUMN = 200;
export const VERTICAL_ROW = 100;

export function verticalPosition(position: Position): Position {
  return { x: (position.y / ROW_HEIGHT) * VERTICAL_COLUMN, y: (position.x / COLUMN_WIDTH) * VERTICAL_ROW };
}

/** 설계의 `graph` 칸이 사이드카 그래프와 잇는 유일한 끈이다 — 사이드카 목록에는 프로젝트 구분이 없다. */
export function matchAssistant(assistants: FlowAssistantView[], graph: string): FlowAssistantView | null {
  const wanted = graph.trim();
  if (!wanted) return null;
  return assistants.find((item) => item.graphId === wanted) ?? assistants.find((item) => item.name === wanted) ?? null;
}

/** 가장 최근의 같은 그래프 스레드. 다른 그래프의 스레드를 겹치면 엉뚱한 노드가 「지금」으로 보인다. */
export function threadForGraph(threads: FlowThreadView[], graphId: string | null): FlowThreadView | null {
  if (!graphId) return null;
  return threads.find((thread) => thread.graphId === graphId) ?? null;
}

export type NodeRunState = "now" | "reached" | "idle";

/**
 * `now` 는 스레드가 지금 기다리는 노드, `reached` 는 이 스레드의 체크포인트 어딘가에서 다음 차례였던 노드다.
 * 「이 노드만 실행」은 `reached` 인 노드에서만 된다 — 갈라 나갈 체크포인트가 있어야 해서다.
 */
export function nodeRunStates(flow: Pick<FlowViewConnected, "currentNodes" | "history"> | null): Map<string, NodeRunState> {
  const states = new Map<string, NodeRunState>();
  if (!flow) return states;
  for (const entry of flow.history) for (const node of entry.next) states.set(node, "reached");
  for (const node of flow.currentNodes) states.set(node, "now");
  return states;
}

export interface ArchitectureNodeDetail {
  id: string;
  label: string;
  reads: string[];
  writes: string[];
  models: Array<{ id: string; provider: string | null }>;
  tools: Array<{ id: string; what: string | null; via: "code" | "mcp" | null; server: string | null; caps: string[] }>;
  documents: Array<{ path: string; when: string }>;
  requirements: Array<{ id: string; text: string }>;
  incoming: string[];
  outgoing: Array<{ to: string; when: string | null }>;
}

export function nodeDetail(ir: Ir, nodeId: string): ArchitectureNodeDetail | null {
  const node = ir.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const requirementIds = new Set(ir.requirementLinks.filter((link) => link.node === nodeId).map((link) => link.requirement));
  return {
    id: node.id,
    label: node.label || node.id,
    reads: node.reads,
    writes: node.writes,
    models: node.models.map((id) => ({ id, provider: ir.models.find((model) => model.id === id)?.provider ?? null })),
    tools: node.tools.map((id) => {
      const tool = ir.tools.find((item) => item.id === id);
      return { id, what: tool?.what ?? null, via: tool?.via ?? null, server: tool?.server ?? null, caps: tool?.caps ?? [] };
    }),
    documents: ir.documents.filter((doc) => doc.node === nodeId).map((doc) => ({ path: doc.path, when: doc.when })),
    requirements: ir.requirements
      .filter((req) => requirementIds.has(req.id))
      .map((req) => ({ id: req.id, text: req.summary ?? req.text })),
    incoming: ir.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from),
    outgoing: ir.edges.filter((edge) => edge.from === nodeId).map((edge) => ({ to: edge.to, when: edge.when ?? null })),
  };
}

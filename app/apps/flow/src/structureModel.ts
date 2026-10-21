import { z } from "zod";

/**
 * 아키텍처 드릴다운 (R3.4, 사용자 결정 2026-10-21 — 이번 판 구현). 배치는 절차
 * `아키텍처-드릴다운-배치조사_20261017_v1`을 따른다: 실행 · 구조 · 흐름 세 장, 세부는 같은 그림에 펼치지 않고 다음 그림으로 교체.
 *
 * 요소와 관계는 모델에 한 번만 두고, 장은 관계 id의 부분집합이다. 경계 노드와 미확인 자리는 저장하지 않고 그릴 때 계산한다.
 * 실행 장의 내용은 이 모델이 아니라 설계 IR과 LangGraph 상태에서 만든다 — 모델의 `run` 장은 목적지만 가진다.
 */

export const STRUCTURE_ROLES = ["process", "store", "external", "person"] as const;
export type StructureRole = (typeof STRUCTURE_ROLES)[number];
export const ROLE_LABEL: Record<StructureRole, string> = { process: "처리", store: "저장", external: "바깥", person: "사람" };
/** 범례 한 줄 뜻. */
export const ROLE_MEANING: Record<StructureRole, string> = {
  process: "데이터를 받아 바꾸거나 넘기는 것",
  store: "기록이 남는 곳 — 쓰기와 읽기가 둘 다 있어야 완성",
  external: "이 시스템 밖의 서비스 · 프로그램",
  person: "화면이나 세션으로 일을 맡기고 결정하는 사람",
};

const evidence = z.string().min(1).nullable();
export const structureElementSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), role: z.enum(STRUCTURE_ROLES),
  parent: z.string().min(1).optional(), note: z.string().optional(), evidence,
});
export const structureRelationshipSchema = z.object({
  id: z.string().min(1), from: z.string().min(1), to: z.string().min(1), label: z.string().min(1),
  effect: z.enum(["read", "write"]).optional(), via: z.string().min(1).optional(), evidence,
});
export const structureViewSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), kind: z.enum(["structure", "decomposition", "scenario", "run"]),
  focus: z.string().min(1).optional(), relationshipIds: z.array(z.string().min(1)).default([]),
  steps: z.record(z.string(), z.number().int().positive()).optional(), graph: z.string().optional(),
});
export const structureModelSchema = z.object({
  title: z.string().optional(),
  elements: z.array(structureElementSchema), relationships: z.array(structureRelationshipSchema), views: z.array(structureViewSchema),
});
export type StructureElement = z.infer<typeof structureElementSchema>;
export type StructureRelationship = z.infer<typeof structureRelationshipSchema>;
export type StructureView = z.infer<typeof structureViewSchema>;
export type StructureModel = z.infer<typeof structureModelSchema>;

/** 장이 어느 칸에 속하나. 분해는 「안에 무엇이 있나」라서 구조 칸, 시나리오는 흐름 칸. */
export type StructureTab = "run" | "structure" | "flow";
export function viewTab(view: Pick<StructureView, "kind">): StructureTab {
  return view.kind === "run" ? "run" : view.kind === "scenario" ? "flow" : "structure";
}

/** 프로젝트 문서 폴더(등록부 `docs`) 안의 구조도. 기존 아키텍처 맵(`아키텍처.json`) 옆에 둔다. */
export function structureRel(docs = "docs"): string {
  return `${docs}/기획/구조도.json`;
}

const byId = <T extends { id: string }>(rows: readonly T[]) => new Map(rows.map(row => [row.id, row]));
const touches = (rel: StructureRelationship, id: string) => rel.from === id || rel.to === id;
/** 라벨에 「 · 」가 들어 있어도 경계가 보이게 하나씩 묶는다. */
const labels = (rows: readonly string[]) => rows.map(row => `「${row}」`).join(", ");

/** 장에 들어 있는 관계만 센다 — 다른 장의 선은 이 장의 검사를 통과시키지도, 실패시키지도 못한다. */
export function viewIssues(model: StructureModel, view: StructureView): string[] {
  const issues: string[] = [];
  const elements = byId(model.elements), rels = byId(model.relationships);
  const used = view.relationshipIds.map(id => rels.get(id)).filter((rel): rel is StructureRelationship => {
    return !!rel;
  });
  for (const id of view.relationshipIds) if (!rels.has(id)) issues.push(`${view.id}: 없는 관계 ${id}`);
  if (view.kind === "run" || view.kind === "structure") {
    if (view.kind === "structure") for (const rel of used) if (rel.via) issues.push(`${view.id}: 구조 장에 하위 선 ${rel.id}이 있다`);
    if (view.kind === "run" && !view.focus) issues.push(`${view.id}: 실행 장에 focus가 없다`);
    return issues;
  }
  const focus = view.focus ? elements.get(view.focus) : undefined;
  if (!focus) return [...issues, `${view.id}: focus 요소가 없다`];
  const isPart = (id: string) => elements.get(id)?.parent === focus.id;
  const viaCount = new Map<string, number>();
  for (const rel of used) {
    if (touches(rel, focus.id)) { issues.push(`${view.id}: ${rel.id}이 초점 「${focus.label}」에 닿는다 — 초점은 노드로 그리지 않는다`); continue; }
    if (!rel.via) {
      if (!isPart(rel.from) || !isPart(rel.to)) issues.push(`${view.id}: ${rel.id}은 via 없이 경계에 닿는다`);
      continue;
    }
    const parent = rels.get(rel.via);
    if (!parent || !touches(parent, focus.id)) { issues.push(`${view.id}: ${rel.id}의 via ${rel.via}는 초점으로 드나드는 관계가 아니다`); continue; }
    viaCount.set(parent.id, (viaCount.get(parent.id) ?? 0) + 1);
    const inbound = parent.to === focus.id;
    const outer = inbound ? parent.from : parent.to;
    const [childOuter, childInner] = inbound ? [rel.from, rel.to] : [rel.to, rel.from];
    if (childOuter !== outer || !isPart(childInner)) issues.push(`${view.id}: ${rel.id}의 방향이나 끝이 부모 ${parent.id}와 다르다`);
    if ((rel.effect ?? null) !== (parent.effect ?? null)) issues.push(`${view.id}: ${rel.id}의 effect가 부모 ${parent.id}와 다르다`);
  }
  for (const [id, count] of viaCount) if (count > 1) issues.push(`${view.id}: 부모 ${id}에 via 선이 ${count}개다`);
  if (view.kind === "scenario") {
    const steps = view.steps ?? {};
    for (const id of view.relationshipIds) if (!(id in steps)) issues.push(`${view.id}: 시나리오의 ${id}에 순서가 없다`);
  } else if (view.steps) issues.push(`${view.id}: 순서 번호는 시나리오에만 둔다`);
  return issues;
}

/** 모델 전체 — 끝이 요소인지, id가 겹치지 않는지, 그리고 장마다의 검사. */
export function modelIssues(model: StructureModel): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const row of [...model.elements, ...model.relationships, ...model.views]) {
    if (ids.has(row.id)) issues.push(`id ${row.id}가 겹친다`);
    ids.add(row.id);
  }
  const elements = byId(model.elements);
  for (const el of model.elements) if (el.parent && !elements.has(el.parent)) issues.push(`${el.id}의 parent ${el.parent}가 없다`);
  for (const rel of model.relationships) if (!elements.has(rel.from) || !elements.has(rel.to)) issues.push(`${rel.id}의 끝이 요소가 아니다`);
  for (const view of model.views) issues.push(...viewIssues(model, view));
  return issues;
}

/** 저장은 via 없는 관계로 모델 전체에서 쓰기 · 읽기를 센다. 한쪽이 없으면 「미완」. */
export function storeGaps(model: StructureModel, elementId: string): ("쓰기 없음" | "읽기 없음")[] {
  const el = model.elements.find(row => row.id === elementId);
  if (el?.role !== "store") return [];
  const top = model.relationships.filter(rel => !rel.via);
  return [
    ...(top.some(rel => rel.to === elementId) ? [] : ["쓰기 없음" as const]),
    ...(top.some(rel => rel.from === elementId) ? [] : ["읽기 없음" as const]),
  ];
}

/** 요소의 목적지 — focus가 그 요소인 장들. LangGraph 요소의 실행 장도 여기 든다. */
export function destinations(model: StructureModel, elementId: string): StructureView[] {
  return model.views.filter(view => view.focus === elementId && view.kind !== "structure");
}

export interface RenderedNode {
  id: string; label: string; role: StructureRole | null;
  /** element: 이 장의 요소 · boundary: 초점 바깥의 끝 · gap: 미확인 자리(그 장에서만 생기는 끝). */
  kind: "element" | "boundary" | "gap";
  evidence: string | null; inside: number; incomplete: string[];
}
export interface RenderedEdge { id: string; source: string; target: string; label: string; effect?: "read" | "write"; dashed: boolean; step?: number; relationshipId: string | null }
export interface RenderedView { view: StructureView; nodes: RenderedNode[]; edges: RenderedEdge[]; scope: string }

function nodeOf(model: StructureModel, el: StructureElement, kind: "element" | "boundary"): RenderedNode {
  return { id: el.id, label: el.label, role: el.role, kind, evidence: el.evidence, inside: kind === "element" ? destinations(model, el.id).length : 0, incomplete: storeGaps(model, el.id) };
}

/** 한 장을 그릴 노드 · 선 · 범위 한 줄로. 실행 장은 여기서 그리지 않는다. */
export function renderView(model: StructureModel, viewId: string): RenderedView {
  const view = model.views.find(row => row.id === viewId);
  if (!view) throw new Error(`없는 장: ${viewId}`);
  if (view.kind === "run") return { view, nodes: [], edges: [], scope: "실행 장 — 승인된 설계와 LangGraph 실행 상태" };
  const elements = byId(model.elements), rels = byId(model.relationships);
  const used = view.relationshipIds.map(id => rels.get(id)).filter((rel): rel is StructureRelationship => !!rel);
  const edgeOf = (rel: StructureRelationship): RenderedEdge => ({
    id: rel.id, source: rel.from, target: rel.to, label: rel.label, ...(rel.effect ? { effect: rel.effect } : {}),
    dashed: !rel.evidence, ...(view.steps?.[rel.id] ? { step: view.steps[rel.id] } : {}), relationshipId: rel.id,
  });
  const dashedNote = (edges: RenderedEdge[]) => edges.some(edge => edge.dashed) ? " 점선은 근거를 확인하지 않은 연결이다." : "";

  if (view.kind === "structure") {
    const ids = new Set<string>(model.elements.filter(el => !el.parent).map(el => el.id));
    for (const rel of used) { ids.add(rel.from); ids.add(rel.to); }
    const nodes = [...ids].map(id => elements.get(id)).filter((el): el is StructureElement => !!el).map(el => nodeOf(model, el, "element"));
    const edges = used.map(edgeOf);
    return { view, nodes, edges, scope: `시스템 전체의 처리 · 저장 · 바깥 ${nodes.length}개와 데이터 연결 ${edges.length}개.${dashedNote(edges)}` };
  }

  const focus = elements.get(view.focus!)!;
  const parts = model.elements.filter(el => el.parent === focus.id);
  const partIds = new Set(parts.map(el => el.id));
  const nodes = new Map<string, RenderedNode>();
  if (view.kind === "decomposition") for (const el of parts) nodes.set(el.id, nodeOf(model, el, "element"));
  const edges = used.map(edgeOf);
  for (const rel of used) for (const id of [rel.from, rel.to]) {
    if (nodes.has(id)) continue;
    const el = elements.get(id);
    if (el) nodes.set(id, nodeOf(model, el, partIds.has(id) ? "element" : "boundary"));
  }
  const parentRels = model.relationships.filter(rel => !rel.via && touches(rel, focus.id));
  const covered = new Set(used.map(rel => rel.via).filter((id): id is string => !!id));
  if (view.kind === "decomposition") {
    // 부모 관계 가운데 이 장에 via 자식 선이 없는 것마다 미확인 자리 하나. 자리끼리는 잇지 않는다.
    const open = parentRels.filter(rel => !covered.has(rel.id));
    for (const rel of open) {
      const inbound = rel.to === focus.id;
      const outer = inbound ? rel.from : rel.to;
      const gapId = `gap:${rel.id}`;
      const el = elements.get(outer);
      if (el && !nodes.has(outer)) nodes.set(outer, nodeOf(model, el, "boundary"));
      nodes.set(gapId, { id: gapId, label: "미확인 자리", role: null, kind: "gap", evidence: null, inside: 0, incomplete: [] });
      edges.push({ id: gapId, source: inbound ? outer : gapId, target: inbound ? gapId : outer, label: rel.label, ...(rel.effect ? { effect: rel.effect } : {}), dashed: true, relationshipId: null });
    }
    const reached = parentRels.filter(rel => covered.has(rel.id)).map(rel => rel.label);
    return { view, nodes: [...nodes.values()], edges, scope: `「${focus.label}」 안의 부분 ${parts.length}개. 부분에 닿는 바깥 연결: ${reached.length ? labels(reached) : "없음"}.${open.length ? ` 미확인 자리에서 끝나는 연결: ${labels(open.map(rel => rel.label))}.` : ""}${dashedNote(edges)}` };
  }
  const usedParents = parentRels.filter(rel => covered.has(rel.id)).map(rel => rel.label);
  const left = parentRels.filter(rel => !covered.has(rel.id)).map(rel => rel.label);
  return { view, nodes: [...nodes.values()], edges, scope: `「${focus.label}」의 한 흐름. 쓰는 바깥 연결: ${usedParents.length ? labels(usedParents) : "없음"}.${left.length ? ` 이 장에 없는 연결: ${labels(left)}.` : ""}${dashedNote(edges)}` };
}

/** 빵 부스러기 — 방문 기록이 아니라 초점 요소의 부모 사슬. 실행 장에는 위가 없다. */
export function breadcrumb(model: StructureModel, viewId: string): StructureView[] {
  const view = model.views.find(row => row.id === viewId);
  if (!view || view.kind === "run") return view ? [view] : [];
  const structure = model.views.find(row => row.kind === "structure");
  if (view.kind === "structure") return [view];
  const chain: StructureView[] = [];
  const elements = byId(model.elements);
  let parent = view.focus ? elements.get(view.focus)?.parent : undefined;
  while (parent) {
    const up = model.views.find(row => row.kind === "decomposition" && row.focus === parent);
    if (up) chain.unshift(up);
    parent = elements.get(parent)?.parent;
  }
  return [...(structure ? [structure] : []), ...chain, view];
}

/** 경계 노드의 「위 장으로」 — 그 요소가 노드로 보이는 위 장. 부모가 없으면 구조 장. */
export function upViewFor(model: StructureModel, elementId: string): StructureView | null {
  const elements = byId(model.elements);
  let parent = elements.get(elementId)?.parent;
  while (parent) {
    const up = model.views.find(row => row.kind === "decomposition" && row.focus === parent);
    if (up) return up;
    parent = elements.get(parent)?.parent;
  }
  return model.views.find(row => row.kind === "structure") ?? null;
}

/** 고른 노드의 옆 설명 — 역할, 읽는 저장 · 쓰는 저장, 근거, 이 장의 선. */
export function elementDetail(model: StructureModel, rendered: RenderedView, nodeId: string) {
  const node = rendered.nodes.find(row => row.id === nodeId);
  if (!node) return null;
  const top = model.relationships.filter(rel => !rel.via);
  const label = (id: string) => model.elements.find(el => el.id === id)?.label ?? id;
  const store = (id: string) => model.elements.find(el => el.id === id)?.role === "store";
  return {
    node,
    note: model.elements.find(el => el.id === nodeId)?.note ?? null,
    reads: top.filter(rel => rel.to === nodeId && store(rel.from)).map(rel => label(rel.from)),
    writes: top.filter(rel => rel.from === nodeId && store(rel.to)).map(rel => label(rel.to)),
    edges: rendered.edges.filter(edge => edge.source === nodeId || edge.target === nodeId).map(edge => ({
      id: edge.id, direction: edge.source === nodeId ? "나감" as const : "들어옴" as const,
      other: edge.source === nodeId ? (rendered.nodes.find(n => n.id === edge.target)?.label ?? edge.target) : (rendered.nodes.find(n => n.id === edge.source)?.label ?? edge.source),
      label: edge.label, evidence: edge.relationshipId ? model.relationships.find(rel => rel.id === edge.relationshipId)?.evidence ?? null : null,
    })),
    destinations: node.kind === "element" ? destinations(model, nodeId) : [],
  };
}

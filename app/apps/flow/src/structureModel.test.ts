import { describe, expect, it } from "vitest";
import { breadcrumb, destinations, modelIssues, renderView, storeGaps, structureModelSchema, upViewFor, viewIssues, viewTab, type StructureModel } from "./structureModel.js";

/** 절차 `아키텍처-드릴다운-배치조사_20261017_v1`의 예시 모델 그대로. */
const example = (): StructureModel => structureModelSchema.parse({
  elements: [
    { id: "person", label: "사람", role: "person", evidence: null },
    { id: "console", label: "콘솔", role: "process", evidence: null },
    { id: "kernel", label: "커널", role: "process", evidence: null },
    { id: "workspace", label: "작업 공간", role: "store", evidence: null },
    { id: "langgraph", label: "LangGraph", role: "process", evidence: null },
    { id: "outside", label: "바깥", role: "external", evidence: null },
    { id: "check", label: "검사", role: "process", parent: "kernel", evidence: null },
    { id: "commit", label: "기록 쓰기", role: "process", parent: "kernel", evidence: null },
  ],
  relationships: [
    { id: "r1", from: "person", to: "console", label: "요청", evidence: null },
    { id: "r2", from: "console", to: "kernel", label: "작업", evidence: null },
    { id: "r3", from: "kernel", to: "workspace", label: "기록", effect: "write", evidence: null },
    { id: "r4", from: "workspace", to: "kernel", label: "조회", effect: "read", evidence: null },
    { id: "r5", from: "kernel", to: "langgraph", label: "실행 입력", evidence: null },
    { id: "r6", from: "kernel", to: "console", label: "결과", evidence: "app/x.ts (2026-10-21)" },
    { id: "r10", from: "kernel", to: "outside", label: "신호", evidence: null },
    { id: "r7", from: "console", to: "check", label: "작업", via: "r2", evidence: null },
    { id: "r8", from: "check", to: "commit", label: "검사 결과", evidence: null },
    { id: "r9", from: "commit", to: "workspace", label: "기록", via: "r3", effect: "write", evidence: null },
  ],
  views: [
    { id: "structure", title: "구조", kind: "structure", relationshipIds: ["r1", "r2", "r3", "r4", "r5", "r6", "r10"] },
    { id: "kernel-parts", title: "커널 분해", kind: "decomposition", focus: "kernel", relationshipIds: ["r7", "r8", "r9"] },
    { id: "kernel-write", title: "커널의 한 번 기록", kind: "scenario", focus: "kernel", relationshipIds: ["r7", "r8", "r9"], steps: { r7: 1, r8: 2, r9: 3 } },
    { id: "langgraph-run", title: "실행", kind: "run", focus: "langgraph", graph: "example" },
  ],
});

describe("계층형 드릴다운 — 구조 · 분해 · 시나리오 · 실행 장", () => {
  it("구조 장에서 요소를 고르면 분해(구조 칸) · 시나리오(흐름 칸) · 실행 장으로 들어가고, 분해는 미확인 자리 · 시나리오는 범위 문장으로 바깥 연결을 보인다", () => {
    const model = example();
    expect(modelIssues(model)).toEqual([]);
    // 「안으로」의 목적지와 그 장이 열리는 칸
    expect(destinations(model, "kernel").map(view => [view.id, viewTab(view)])).toEqual([["kernel-parts", "structure"], ["kernel-write", "flow"]]);
    expect(destinations(model, "langgraph").map(view => [view.id, viewTab(view)])).toEqual([["langgraph-run", "run"]]);
    expect(destinations(model, "workspace")).toEqual([]);

    const structure = renderView(model, "structure");
    expect(structure.nodes.find(node => node.id === "kernel")).toMatchObject({ kind: "element", inside: 2 });
    expect(structure.edges.find(edge => edge.id === "r6")!.dashed).toBe(false);
    expect(structure.edges.find(edge => edge.id === "r1")!.dashed).toBe(true);
    expect(structure.edges.every(edge => edge.step === undefined)).toBe(true);

    const parts = renderView(model, "kernel-parts");
    expect(parts.nodes.filter(node => node.kind === "element").map(node => node.id).sort()).toEqual(["check", "commit"]);
    expect(parts.nodes.filter(node => node.kind === "boundary").map(node => node.id).sort()).toEqual(["console", "langgraph", "outside", "workspace"]);
    expect(parts.nodes.some(node => node.id === "kernel")).toBe(false);
    const gaps = parts.edges.filter(edge => edge.id.startsWith("gap:"));
    expect(gaps.map(edge => edge.label).sort()).toEqual(["결과", "신호", "실행 입력", "조회"]);
    expect(gaps.find(edge => edge.label === "조회")).toMatchObject({ source: "workspace", target: "gap:r4", effect: "read", dashed: true });
    expect(parts.scope).toContain("부분에 닿는 바깥 연결: 「작업」, 「기록」.");
    expect(parts.scope).toContain("미확인 자리에서 끝나는 연결: 「조회」, 「실행 입력」, 「결과」, 「신호」.");

    const flow = renderView(model, "kernel-write");
    expect(flow.nodes.some(node => node.kind === "gap")).toBe(false);
    expect(flow.edges.map(edge => [edge.id, edge.step])).toEqual([["r7", 1], ["r8", 2], ["r9", 3]]);
    expect(flow.scope).toContain("쓰는 바깥 연결: 「작업」, 「기록」.");
    expect(flow.scope).toContain("이 장에 없는 연결: 「조회」, 「실행 입력」, 「결과」, 「신호」.");

    // 빵 부스러기는 부모 사슬, 실행 장에는 위가 없다. 경계 노드는 「위 장으로」.
    expect(breadcrumb(model, "kernel-write").map(view => view.id)).toEqual(["structure", "kernel-write"]);
    expect(breadcrumb(model, "langgraph-run").map(view => view.id)).toEqual(["langgraph-run"]);
    expect(upViewFor(model, "commit")!.id).toBe("kernel-parts");
    expect(upViewFor(model, "console")!.id).toBe("structure");
    // 저장은 모델 전체에서 쓰기 · 읽기를 센다
    expect(storeGaps(model, "workspace")).toEqual([]);
  });

  it("균형 검사는 via 없이 경계에 닿는 선 · effect 불일치 · 방향 불일치 · 한 부모의 via 여럿을 잡는다", () => {
    const model = example();
    model.relationships.push(
      { id: "bad1", from: "console", to: "commit", label: "작업", evidence: null },
      { id: "bad2", from: "check", to: "workspace", label: "기록", via: "r3", evidence: null },
      { id: "bad3", from: "check", to: "console", label: "작업", via: "r2", evidence: null },
    );
    const view = { ...model.views[1]!, relationshipIds: ["r7", "r8", "r9", "bad1", "bad2", "bad3"] };
    const issues = viewIssues(model, view);
    expect(issues.some(text => text.includes("bad1은 via 없이 경계에 닿는다"))).toBe(true);
    expect(issues.some(text => text.includes("bad2의 effect가 부모 r3와 다르다"))).toBe(true);
    expect(issues.some(text => text.includes("bad3의 방향이나 끝이 부모 r2와 다르다"))).toBe(true);
    expect(issues.some(text => text.includes("부모 r2에 via 선이 2개다"))).toBe(true);
    expect(issues.some(text => text.includes("부모 r3에 via 선이 2개다"))).toBe(true);
    // 쓰기만 있는 저장은 미완
    model.relationships = model.relationships.filter(rel => rel.id !== "r4");
    expect(storeGaps(model, "workspace")).toEqual(["읽기 없음"]);
  });
});

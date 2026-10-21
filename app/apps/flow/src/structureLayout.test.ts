import { describe, expect, it } from "vitest";
import { layoutStructure } from "./structureLayout.js";

describe("구조 장 배치", () => {
  it("오가는 선이 있어도 위에서 아래로 층을 나누고, 선마다 꺾는 경로와 라벨 자리를 돌려준다", async () => {
    const node = (id: string) => ({ id, label: id, role: "process" as const, kind: "element" as const, evidence: null, inside: 0, incomplete: [] });
    const edge = (id: string, source: string, target: string) => ({ id, source, target, label: id, dashed: true, relationshipId: id });
    const laid = await layoutStructure({
      nodes: [node("person"), node("console"), node("kernel"), node("workspace")],
      edges: [edge("요청", "person", "console"), edge("작업", "console", "kernel"), edge("결과", "kernel", "console"), edge("기록", "kernel", "workspace"), edge("조회", "workspace", "kernel")],
    });
    const y = (id: string) => laid.nodes.find(n => n.id === id)!.y;
    expect(y("person")).toBeLessThan(y("console"));
    expect(y("console")).toBeLessThan(y("kernel"));
    expect(y("kernel")).toBeLessThan(y("workspace"));
    expect(laid.edges).toHaveLength(5);
    for (const e of laid.edges) { expect(e.points.length).toBeGreaterThanOrEqual(2); expect(e.label).not.toBeNull(); }
    // 라벨끼리 포개지지 않는다
    const boxes = laid.edges.map(e => e.label!);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { splitVia } from "./DocumentCallPanel.js";
import { toKnowledgeCanvas } from "./knowledgeCanvas.js";

describe("toKnowledgeCanvas", () => {
  it("returns no nodes without a selection, flags the current one, and names each relation", () => {
    expect(toKnowledgeCanvas(null, [], [])).toEqual({ nodes: [], edges: [] });
    const selected = { path: "docs", name: "docs", label: "Folder" as const, port: null, level: 1 as const, text: null };
    const child = {
      path: "docs/a.md",
      name: "a.md",
      label: "File" as const,
      port: "source:docs/a.md",
      level: 2 as const,
      text: null,
    };
    const { nodes, edges } = toKnowledgeCanvas(selected, [child], [
      { from: "docs", to: "docs/a.md", kind: "CONTAINS" },
    ]);
    expect(nodes.find((n) => n.id === "docs")?.data.current).toBe(true);
    expect(nodes.find((n) => n.id === "docs/a.md")?.data.kind).toBe("File");
    expect(edges).toEqual([
      { id: "docs->docs/a.md:0", source: "docs", target: "docs/a.md", label: "CONTAINS" },
    ]);
  });
});

describe("splitVia", () => {
  it("splits an evidence path into nodes and the relations between them", () => {
    expect(splitVia("classify -[FLOWS_TO]-> pick -[CONSULTS]-> D1")).toEqual([
      { node: "classify", relation: null, back: false },
      { node: "pick", relation: "FLOWS_TO", back: false },
      { node: "D1", relation: "CONSULTS", back: false },
    ]);
  });

  it("keeps the direction of a step walked against the arrow", () => {
    // `AT` 는 문서 → 파일이다. 파일에서 출발하면 화살을 거슬러 걷고, 그 사실이 경로에 남는다.
    expect(splitVia("bug.md <-[AT]- D1")).toEqual([
      { node: "bug.md", relation: null, back: false },
      { node: "D1", relation: "AT", back: true },
    ]);
  });

  it("returns the anchor alone when the anchor is the answer", () => {
    expect(splitVia("D1")).toEqual([{ node: "D1", relation: null, back: false }]);
  });
});

import { describe, expect, it } from "vitest";
import { toBoardCanvas } from "./boardCanvas.js";

describe("toBoardCanvas", () => {
  it("keeps yaml coordinates and drops links whose ends are missing", () => {
    const { nodes, edges } = toBoardCanvas(
      [
        { id: "langgraph:flow:a", kind: "langgraph", ref: "flow:a", title: "a", x: 120, y: 80 },
        { id: "neo4j:file:README.md", kind: "neo4j", ref: "README.md", title: "README", x: 0, y: 40 },
      ],
      [
        { from: "langgraph:flow:a", to: "neo4j:file:README.md" },
        { from: "langgraph:flow:a", to: "missing" },
      ],
    );
    expect(nodes.map((node) => node.position)).toEqual([
      { x: 120, y: 80 },
      { x: 0, y: 40 },
    ]);
    expect(nodes[0]?.data.kind).toBe("langgraph");
    expect(nodes[0]?.className).toBe("board-node-langgraph");
    expect(edges).toEqual([{ id: "langgraph:flow:a->neo4j:file:README.md", source: "langgraph:flow:a", target: "neo4j:file:README.md" }]);
  });

  it("marks architecture items so the canvas can style the structure map", () => {
    const { nodes } = toBoardCanvas(
      [{ id: "arch:structure", kind: "port", ref: "source:docs/기획/아키텍처.md", title: "아키텍처 구조", x: 24, y: 24 }],
      [],
    );
    expect(nodes[0]?.className).toBe("board-node-port board-node-arch");
  });
});

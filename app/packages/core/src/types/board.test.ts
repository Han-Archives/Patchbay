import { describe, expect, it } from "vitest";
import { boardSchema } from "./board.js";

describe("board.yaml schema", () => {
  it("defaults a missing file shape to empty items and links", () => {
    const result = boardSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ items: [], links: [] });
    }
  });

  it("accepts the three frozen kinds", () => {
    const result = boardSchema.safeParse({
      items: [
        { id: "langgraph:research_flow:draft", kind: "langgraph", ref: "research_flow:draft", title: "LangGraph · draft", x: 120, y: 80 },
        { id: "neo4j:file:README.md", kind: "neo4j", ref: "README.md", title: "README", x: 0, y: 0 },
        { id: "port:source:README.md", kind: "port", ref: "source:README.md", title: "README port", x: 40, y: 40 },
      ],
      links: [{ from: "langgraph:research_flow:draft", to: "neo4j:file:README.md" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a kind outside langgraph|neo4j|port and non-integer coordinates", () => {
    expect(boardSchema.safeParse({ items: [{ id: "x", kind: "canvas", ref: "x", title: "x", x: 0, y: 0 }] }).success).toBe(
      false,
    );
    expect(
      boardSchema.safeParse({ items: [{ id: "x", kind: "port", ref: "x", title: "x", x: 1.5, y: 0 }] }).success,
    ).toBe(false);
  });
});

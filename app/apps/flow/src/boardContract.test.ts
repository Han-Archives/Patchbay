import { describe, expect, it } from "vitest";
import {
  langgraphBoardId,
  langgraphBoardRef,
  neo4jBoardId,
  nextBoardSlot,
  portBoardId,
  roundBoardCoord,
} from "./boardContract.js";

describe("board freeze values", () => {
  it("builds the three frozen ids and the omitted-coord lattice", () => {
    expect(langgraphBoardRef("research_flow", "draft")).toBe("research_flow:draft");
    expect(langgraphBoardId("research_flow", "draft")).toBe("langgraph:research_flow:draft");
    expect(neo4jBoardId("File", "README.md")).toBe("neo4j:file:README.md");
    expect(portBoardId("source:README.md")).toBe("port:source:README.md");
    expect(nextBoardSlot(0)).toEqual({ x: 0, y: 0 });
    expect(nextBoardSlot(1)).toEqual({ x: 220, y: 0 });
    expect(nextBoardSlot(4)).toEqual({ x: 0, y: 100 });
    expect(roundBoardCoord(39.6)).toBe(40);
  });
});
